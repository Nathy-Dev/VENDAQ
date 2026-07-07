/**
 * AI Service Layer for Pipelixr
 *
 * Provides intelligent message processing using:
 *   - Groq (LLaMA) for intent classification and smart reply generation
 *   - OpenAI (GPT-4o-mini) for image/vision analysis
 *
 * Every AI call has a timeout and graceful fallback to keyword matching.
 * All AI decisions are logged to the aiActivityLog table for the dashboard feed.
 *
 * Required Convex environment variables:
 *   GROQ_API_KEY     - Groq API key
 *   OPENAI_API_KEY   - OpenAI API key
 */

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import * as evoClient from "./evolutionGoClient";
import * as cloudinary from "./cloudinary";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_VISION_MODEL = "gpt-4o-mini";
const AI_TIMEOUT_MS = 8000; // 8s max for any AI call
const MAX_CONVERSATION_CONTEXT = 10; // Last N messages for context

// ─── Groq LLM Client ────────────────────────────────────────────────────────

async function callGroq(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options?: { model?: string; temperature?: number; maxTokens?: number }
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const model = options?.model || DEFAULT_GROQ_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 512,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq API ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } finally {
    clearTimeout(timeout);
  }
}

// ─── OpenAI Vision Client ────────────────────────────────────────────────────

async function callOpenAIVision(
  imageUrl: string,
  prompt: string,
  options?: { model?: string; maxTokens?: number }
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const model = options?.model || DEFAULT_VISION_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS + 4000); // Vision needs more time

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
            ],
          },
        ],
        max_tokens: options?.maxTokens ?? 300,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI Vision ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Intent Classification ──────────────────────────────────────────────────

const CLASSIFY_SYSTEM_PROMPT = `You are an intent classifier for WhatsApp business messages in Nigeria. Classify the customer message into exactly one category.

Categories:
- BUYING_SIGNAL: Customer wants to buy, asks about price, availability, ordering, payment. Includes Nigerian pidgin like "how much", "e dey?", "I wan buy", "wetin be the price", "abeg send price", "last price?", "you get size 42?", "e still dey?", "I need am", screenshots of products they want.
- GENERAL_INQUIRY: Customer asks a question but not about buying — e.g. business hours, location, warranty, general info.
- NOISE: Greetings with no buying context ("hello", "hi", "good morning"), acknowledgments ("ok", "thanks", "seen"), spam, or unrelated messages.

Respond in this exact JSON format only (no markdown, no explanation):
{"classification":"BUYING_SIGNAL|GENERAL_INQUIRY|NOISE","confidence":0.0,"reasoning":"brief explanation"}`;

type AIClassificationResult = {
  classification: "BUYING_SIGNAL" | "GENERAL_INQUIRY" | "NOISE";
  confidence: number;
  reasoning: string;
};

function parseClassificationResponse(raw: string): AIClassificationResult | null {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const parsed = JSON.parse(cleaned);
    if (
      parsed.classification &&
      ["BUYING_SIGNAL", "GENERAL_INQUIRY", "NOISE"].includes(parsed.classification)
    ) {
      return {
        classification: parsed.classification,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
        reasoning: String(parsed.reasoning || "").slice(0, 200),
      };
    }
  } catch {
    // Try regex fallback
    const match = raw.match(/"classification"\s*:\s*"(BUYING_SIGNAL|GENERAL_INQUIRY|NOISE)"/);
    if (match) {
      return {
        classification: match[1] as AIClassificationResult["classification"],
        confidence: 0.6,
        reasoning: "Parsed from partial response",
      };
    }
  }
  return null;
}

// ─── Smart Reply Generation ─────────────────────────────────────────────────

const REPLY_SYSTEM_PROMPT = `You are a friendly, efficient WhatsApp sales assistant for a Nigerian business. Generate a natural reply that:
- Is warm but not overly formal — match the tone Nigerian customers expect on WhatsApp
- Gets straight to helping them buy — don't waste their time
- Uses their name naturally
- References their specific interest if known
- Is concise (2-3 sentences max, WhatsApp messages should be short)
- Never uses markdown, bullet points, or formatting — this is WhatsApp, keep it plain text
- Can include 1 emoji max if appropriate
- Ends with a clear next step or question

DO NOT include any preamble or explanation. Output ONLY the message to send.`;

// ─── Image Analysis ─────────────────────────────────────────────────────────

const VISION_PROMPT = `Analyze this image sent by a customer on WhatsApp to a business. Determine:

1. What product/item is shown (if any)
2. Any visible text (price tags, labels, brand names)
3. Whether this looks like a product inquiry (customer wants to buy something similar)
4. Whether this is a payment receipt/screenshot

Respond in this exact JSON format only:
{"product":"description of product or null","visibleText":"any text found or null","isBuyingSignal":true/false,"isPaymentProof":true/false,"summary":"1-sentence summary of what the customer likely wants"}`;

type ImageAnalysisResult = {
  product: string | null;
  visibleText: string | null;
  isBuyingSignal: boolean;
  isPaymentProof: boolean;
  summary: string;
};

function parseImageAnalysis(raw: string): ImageAnalysisResult | null {
  try {
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      product: parsed.product || null,
      visibleText: parsed.visibleText || null,
      isBuyingSignal: !!parsed.isBuyingSignal,
      isPaymentProof: !!parsed.isPaymentProof,
      summary: String(parsed.summary || "Image received").slice(0, 300),
    };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVEX ACTIONS — Called from the message processing pipeline
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classifies a message using Groq LLM and updates the interaction record.
 * Called asynchronously after receiveMessage() stores the initial keyword classification.
 * If the AI disagrees with keyword matching and finds a buying signal the keywords missed,
 * it upgrades the classification and creates a follow-up task.
 */
export const classifyMessageWithAI = action({
  args: {
    businessId: v.id("businesses"),
    interactionId: v.id("interactions"),
    customerId: v.id("customers"),
    content: v.string(),
    messageType: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
    keywordClassification: v.string(), // The keyword-based classification as fallback reference
  },
  handler: async (ctx, args): Promise<{ success: boolean; classification?: string }> => {
    const business = await ctx.runQuery(api.ai.getBusinessAIConfig, {
      businessId: args.businessId,
    });

    // Skip if AI is explicitly disabled
    if (business?.aiEnabled === false) {
      return { success: false };
    }

    const groqModel = business?.aiLlmModel || DEFAULT_GROQ_MODEL;
    const visionModel = business?.aiVisionModel || DEFAULT_VISION_MODEL;
    const customer = await ctx.runQuery(api.whatsapp.getCustomerLiteById, {
      customerId: args.customerId,
    });
    const customerName = customer?.name || "Customer";

    // ── Step 1: Get conversation context ──
    const recentMessages = await ctx.runQuery(api.ai.getRecentConversation, {
      customerId: args.customerId,
      limit: MAX_CONVERSATION_CONTEXT,
    });

    const conversationContext = recentMessages
      .map((m) => `${m.role === "customer" ? customerName : "Business"}: ${m.content}`)
      .join("\n");

    // ── Step 2: Classify with Groq ──
    let aiResult: AIClassificationResult | null = null;
    try {
      const userMessage = conversationContext
        ? `Conversation context:\n${conversationContext}\n\nLatest message to classify:\n"${args.content}"`
        : `Message to classify:\n"${args.content}"`;

      const raw = await callGroq(
        [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        { model: groqModel, temperature: 0.1, maxTokens: 150 }
      );

      aiResult = parseClassificationResponse(raw);
    } catch (err) {
      console.error("[AI classifyMessage] Groq error:", err);
      // Log error to activity feed
      await ctx.runMutation(api.ai.logAIActivity, {
        businessId: args.businessId,
        type: "error",
        interactionId: args.interactionId,
        customerId: args.customerId,
        customerName,
        summary: `AI classification failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        model: groqModel,
        timestamp: Date.now(),
      });
      return { success: false };
    }

    if (!aiResult) {
      return { success: false };
    }

    // ── Step 3: Image analysis if media is attached ──
    let imageAnalysis: string | undefined;
    if (args.mediaUrl && ["image", "video"].includes(args.messageType || "")) {
      try {
        const visionRaw = await callOpenAIVision(args.mediaUrl, VISION_PROMPT, {
          model: visionModel,
        });
        const parsed = parseImageAnalysis(visionRaw);
        if (parsed) {
          imageAnalysis = JSON.stringify(parsed);

          // If image analysis detects a buying signal but text didn't, upgrade
          if (parsed.isBuyingSignal && aiResult.classification !== "BUYING_SIGNAL") {
            aiResult.classification = "BUYING_SIGNAL";
            aiResult.confidence = Math.max(aiResult.confidence, 0.8);
            aiResult.reasoning = `Image analysis: ${parsed.summary}`;
          }

          // Log image analysis activity
          await ctx.runMutation(api.ai.logAIActivity, {
            businessId: args.businessId,
            type: "image_analysis",
            interactionId: args.interactionId,
            customerId: args.customerId,
            customerName,
            summary: `Analyzed image from ${customerName}: ${parsed.summary}`,
            details: imageAnalysis,
            model: visionModel,
            confidence: parsed.isBuyingSignal ? 0.9 : 0.7,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error("[AI classifyMessage] Vision error:", err);
        // Non-fatal — we still have the text classification
      }
    }

    // ── Step 4: Update the interaction record with AI results ──
    await ctx.runMutation(api.ai.updateInteractionAI, {
      interactionId: args.interactionId,
      aiClassification: aiResult.classification,
      aiConfidence: aiResult.confidence,
      aiReasoning: aiResult.reasoning,
      imageAnalysis,
      aiProcessedAt: Date.now(),
    });

    // ── Step 5: Check if AI disagrees with keyword matching (intent upgrade) ──
    const keywordSaidNoise = args.keywordClassification === "NOISE";
    const keywordSaidInquiry = args.keywordClassification === "GENERAL_INQUIRY";
    const aiSaysBuying = aiResult.classification === "BUYING_SIGNAL";
    const aiSaysInquiry = aiResult.classification === "GENERAL_INQUIRY";

    // If keywords missed a buying signal, upgrade and create follow-up task
    if (aiSaysBuying && (keywordSaidNoise || keywordSaidInquiry) && aiResult.confidence >= 0.7) {
      await ctx.runMutation(api.ai.upgradeCustomerIntent, {
        businessId: args.businessId,
        customerId: args.customerId,
        newIntent: "BUYING_SIGNAL",
        interactionId: args.interactionId,
      });

      await ctx.runMutation(api.ai.logAIActivity, {
        businessId: args.businessId,
        type: "intent_upgrade",
        interactionId: args.interactionId,
        customerId: args.customerId,
        customerName,
        summary: `Upgraded "${args.content.slice(0, 50)}..." from ${args.keywordClassification} → BUYING_SIGNAL (${Math.round(aiResult.confidence * 100)}% confidence). ${aiResult.reasoning}`,
        model: groqModel,
        confidence: aiResult.confidence,
        timestamp: Date.now(),
      });
    }

    // Log standard classification
    await ctx.runMutation(api.ai.logAIActivity, {
      businessId: args.businessId,
      type: "classification",
      interactionId: args.interactionId,
      customerId: args.customerId,
      customerName,
      summary: `Classified "${args.content.slice(0, 60)}${args.content.length > 60 ? "..." : ""}" as ${aiResult.classification} (${Math.round(aiResult.confidence * 100)}%). ${aiResult.reasoning}`,
      model: groqModel,
      confidence: aiResult.confidence,
      timestamp: Date.now(),
    });

    return { success: true, classification: aiResult.classification };
  },
});

/**
 * Generates an AI-powered follow-up message using Groq.
 * Called by processBuyingSignalFollowUp when the response window expires.
 * Falls back to the template if AI fails.
 */
export const generateSmartFollowUp = action({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    customerName: v.string(),
    fallbackTemplate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ message: string; isAI: boolean }> => {
    const business = await ctx.runQuery(api.ai.getBusinessAIConfig, {
      businessId: args.businessId,
    });

    if (business?.aiEnabled === false) {
      const fallback = args.fallbackTemplate || `Hi ${args.customerName}, thanks for reaching out. We saw your message and will get back to you shortly. What exactly were you looking for today?`;
      return { message: fallback, isAI: false };
    }

    const groqModel = business?.aiLlmModel || DEFAULT_GROQ_MODEL;

    // Get conversation context
    const recentMessages = await ctx.runQuery(api.ai.getRecentConversation, {
      customerId: args.customerId,
      limit: MAX_CONVERSATION_CONTEXT,
    });

    // Get customer memory
    const customer = await ctx.runQuery(api.whatsapp.getCustomerLiteById, {
      customerId: args.customerId,
    });

    const memoryContext = [
      customer?.memoryLastAskedTopic && `Last topic: ${customer.memoryLastAskedTopic}`,
      customer?.memoryPreferredCategory && `Preferred category: ${customer.memoryPreferredCategory}`,
      customer?.memoryLastObjection && `Last objection: ${customer.memoryLastObjection}`,
    ]
      .filter(Boolean)
      .join(". ");

    const conversationContext = recentMessages
      .map((m) => `${m.role === "customer" ? args.customerName : "Business"}: ${m.content}`)
      .join("\n");

    try {
      const userPrompt = `Customer name: ${args.customerName}
Business name: ${business?.name || "our business"}
${memoryContext ? `Customer memory: ${memoryContext}` : ""}
${conversationContext ? `Recent conversation:\n${conversationContext}` : "No prior conversation."}

Generate a follow-up message because the business owner hasn't replied yet. The customer showed buying interest.`;

      const message = await callGroq(
        [
          { role: "system", content: REPLY_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        { model: groqModel, temperature: 0.6, maxTokens: 200 }
      );

      if (message && message.length > 10 && message.length < 500) {
        // Log smart reply activity
        await ctx.runMutation(api.ai.logAIActivity, {
          businessId: args.businessId,
          type: "smart_reply",
          customerId: args.customerId,
          customerName: args.customerName,
          summary: `Generated follow-up for ${args.customerName}: "${message.slice(0, 80)}..."`,
          model: groqModel,
          timestamp: Date.now(),
        });

        return { message, isAI: true };
      }
    } catch (err) {
      console.error("[AI generateSmartFollowUp] Groq error:", err);
    }

    // Fallback to template
    const fallback =
      args.fallbackTemplate?.replace(/\[Customer Name\]/gi, args.customerName) ||
      `Hi ${args.customerName}, thanks for reaching out. We saw your message and will get back to you shortly. What exactly were you looking for today?`;
    return { message: fallback, isAI: false };
  },
});

/**
 * Generates an intelligent real-time reply for the assistant.
 * Replaces the hardcoded buildRealtimeAssistantReply().
 */
export const generateAssistantReply = action({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    customerName: v.string(),
    inboundContent: v.string(),
    lastIntent: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ message: string; isAI: boolean }> => {
    const business = await ctx.runQuery(api.ai.getBusinessAIConfig, {
      businessId: args.businessId,
    });

    if (business?.aiEnabled === false) {
      // Fall back to the existing hardcoded logic
      return { message: buildFallbackReply(args.customerName, args.lastIntent, args.inboundContent), isAI: false };
    }

    const groqModel = business?.aiLlmModel || DEFAULT_GROQ_MODEL;

    const recentMessages = await ctx.runQuery(api.ai.getRecentConversation, {
      customerId: args.customerId,
      limit: 6,
    });

    const customer = await ctx.runQuery(api.whatsapp.getCustomerLiteById, {
      customerId: args.customerId,
    });

    const memoryContext = [
      customer?.memoryLastAskedTopic && `They previously asked about: ${customer.memoryLastAskedTopic}`,
      customer?.memoryPreferredCategory && `They prefer: ${customer.memoryPreferredCategory}`,
      customer?.memoryLastObjection && `Their concern was: ${customer.memoryLastObjection}`,
    ]
      .filter(Boolean)
      .join(". ");

    const conversationContext = recentMessages
      .map((m) => `${m.role === "customer" ? args.customerName : "Business"}: ${m.content}`)
      .join("\n");

    try {
      const userPrompt = `Customer: ${args.customerName}
Business: ${business?.name || "our business"}
${memoryContext ? `What we know: ${memoryContext}` : ""}
${conversationContext ? `Conversation:\n${conversationContext}` : ""}

New message from customer: "${args.inboundContent}"

Reply as the business, helping them buy.`;

      const message = await callGroq(
        [
          { role: "system", content: REPLY_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        { model: groqModel, temperature: 0.5, maxTokens: 200 }
      );

      if (message && message.length > 5 && message.length < 500) {
        await ctx.runMutation(api.ai.logAIActivity, {
          businessId: args.businessId,
          type: "smart_reply",
          customerId: args.customerId,
          customerName: args.customerName,
          summary: `Auto-replied to ${args.customerName}: "${message.slice(0, 80)}..."`,
          model: groqModel,
          timestamp: Date.now(),
        });

        return { message, isAI: true };
      }
    } catch (err) {
      console.error("[AI generateAssistantReply] Groq error:", err);
    }

    return { message: buildFallbackReply(args.customerName, args.lastIntent, args.inboundContent), isAI: false };
  },
});

/**
 * Analyzes an image using OpenAI Vision.
 * Called when a media message arrives with a downloadable URL.
 */
export const analyzeImage = action({
  args: {
    businessId: v.id("businesses"),
    interactionId: v.id("interactions"),
    customerId: v.id("customers"),
    imageUrl: v.string(),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; analysis?: string }> => {
    const business = await ctx.runQuery(api.ai.getBusinessAIConfig, {
      businessId: args.businessId,
    });

    if (business?.aiEnabled === false) {
      return { success: false };
    }

    const visionModel = business?.aiVisionModel || DEFAULT_VISION_MODEL;
    const customer = await ctx.runQuery(api.whatsapp.getCustomerLiteById, {
      customerId: args.customerId,
    });
    const customerName = customer?.name || "Customer";

    try {
      const prompt = args.caption
        ? `${VISION_PROMPT}\n\nThe customer also sent this caption with the image: "${args.caption}"`
        : VISION_PROMPT;

      const raw = await callOpenAIVision(args.imageUrl, prompt, { model: visionModel });
      const parsed = parseImageAnalysis(raw);

      if (parsed) {
        const analysisJson = JSON.stringify(parsed);

        // Update interaction record
        await ctx.runMutation(api.ai.updateInteractionAI, {
          interactionId: args.interactionId,
          imageAnalysis: analysisJson,
          aiProcessedAt: Date.now(),
          // If image is a buying signal, upgrade classification
          ...(parsed.isBuyingSignal
            ? { aiClassification: "BUYING_SIGNAL", aiConfidence: 0.85, aiReasoning: parsed.summary }
            : {}),
        });

        // If this is a buying signal from an image, upgrade customer intent
        if (parsed.isBuyingSignal) {
          await ctx.runMutation(api.ai.upgradeCustomerIntent, {
            businessId: args.businessId,
            customerId: args.customerId,
            newIntent: "BUYING_SIGNAL",
            interactionId: args.interactionId,
          });
        }

        // Log to activity feed
        await ctx.runMutation(api.ai.logAIActivity, {
          businessId: args.businessId,
          type: "image_analysis",
          interactionId: args.interactionId,
          customerId: args.customerId,
          customerName,
          summary: `Analyzed image from ${customerName}: ${parsed.summary}`,
          details: analysisJson,
          model: visionModel,
          confidence: parsed.isBuyingSignal ? 0.9 : 0.7,
          timestamp: Date.now(),
        });

        return { success: true, analysis: analysisJson };
      }
    } catch (err) {
      console.error("[AI analyzeImage] Vision error:", err);
      await ctx.runMutation(api.ai.logAIActivity, {
        businessId: args.businessId,
        type: "error",
        interactionId: args.interactionId,
        customerId: args.customerId,
        customerName,
        summary: `Image analysis failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        model: visionModel,
        timestamp: Date.now(),
      });
    }

    return { success: false };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATIONS — Database operations for AI results
// ═══════════════════════════════════════════════════════════════════════════════

/** Updates an interaction record with AI classification results. */
export const updateInteractionAI = mutation({
  args: {
    interactionId: v.id("interactions"),
    aiClassification: v.optional(v.string()),
    aiConfidence: v.optional(v.number()),
    aiReasoning: v.optional(v.string()),
    imageAnalysis: v.optional(v.string()),
    aiProcessedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.aiClassification !== undefined) patch.aiClassification = args.aiClassification;
    if (args.aiConfidence !== undefined) patch.aiConfidence = args.aiConfidence;
    if (args.aiReasoning !== undefined) patch.aiReasoning = args.aiReasoning;
    if (args.imageAnalysis !== undefined) patch.imageAnalysis = args.imageAnalysis;
    if (args.aiProcessedAt !== undefined) patch.aiProcessedAt = args.aiProcessedAt;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.interactionId, patch);
    }
  },
});

/**
 * Upgrades a customer's intent when AI detects a buying signal that keywords missed.
 * Also creates a follow-up task if one doesn't already exist.
 */
export const upgradeCustomerIntent = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    newIntent: v.string(),
    interactionId: v.id("interactions"),
  },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return;

    // Update customer intent and funnel stage
    await ctx.db.patch(args.customerId, {
      lastIntent: args.newIntent,
      funnelStage: args.newIntent === "BUYING_SIGNAL" ? "intent" : customer.funnelStage,
    });

    // Check if there's already a pending buying_signal task
    if (args.newIntent === "BUYING_SIGNAL") {
      const existingTask = await ctx.db
        .query("followUpTasks")
        .withIndex("by_customer_reason", (q) =>
          q.eq("customerId", args.customerId).eq("reason", "buying_signal")
        )
        .filter((q) => q.eq(q.field("status"), "pending"))
        .first();

      if (!existingTask) {
        const biz = await ctx.db.get(args.businessId);
        const windowMs = biz?.responseWindowMinutes
          ? biz.responseWindowMinutes * 60 * 1000
          : 2 * 60 * 60 * 1000; // Default 2 hours

        await ctx.db.insert("followUpTasks", {
          businessId: args.businessId,
          customerId: args.customerId,
          reason: "buying_signal",
          dueAt: Date.now() + windowMs,
          status: "pending",
          createdAt: Date.now(),
        });
      }
    }
  },
});

/** Logs an AI activity to the feed. */
export const logAIActivity = mutation({
  args: {
    businessId: v.id("businesses"),
    type: v.union(
      v.literal("classification"),
      v.literal("image_analysis"),
      v.literal("smart_reply"),
      v.literal("intent_upgrade"),
      v.literal("error")
    ),
    interactionId: v.optional(v.id("interactions")),
    customerId: v.optional(v.id("customers")),
    customerName: v.optional(v.string()),
    summary: v.string(),
    details: v.optional(v.string()),
    model: v.string(),
    confidence: v.optional(v.number()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiActivityLog", {
      businessId: args.businessId,
      type: args.type,
      interactionId: args.interactionId,
      customerId: args.customerId,
      customerName: args.customerName,
      summary: args.summary,
      details: args.details,
      model: args.model,
      confidence: args.confidence,
      timestamp: args.timestamp,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUERIES — For the dashboard and settings
// ═══════════════════════════════════════════════════════════════════════════════

/** Returns business AI config (used by AI actions to check if AI is enabled). */
export const getBusinessAIConfig = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const biz = await ctx.db.get(args.businessId);
    if (!biz) return null;
    return {
      name: biz.name,
      aiEnabled: biz.aiEnabled ?? true, // Default enabled
      aiLlmModel: biz.aiLlmModel,
      aiVisionModel: biz.aiVisionModel,
      followUpTemplate: biz.followUpTemplate,
    };
  },
});

/** Returns recent conversation messages for context. */
export const getRecentConversation = query({
  args: {
    customerId: v.id("customers"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || MAX_CONVERSATION_CONTEXT;
    const messages = await ctx.db
      .query("interactions")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(limit);

    // Return in chronological order
    return messages.reverse().map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      intent: m.intent,
      aiClassification: m.aiClassification,
    }));
  },
});

/** Returns recent AI activity for the dashboard feed. */
export const getAIActivityFeed = query({
  args: {
    businessId: v.id("businesses"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit || 30, 100);
    return await ctx.db
      .query("aiActivityLog")
      .withIndex("by_business_time", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(limit);
  },
});

/** Returns AI metrics for the dashboard (today's stats). */
export const getAIMetrics = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const since = todayStart.getTime();

    const allActivity = await ctx.db
      .query("aiActivityLog")
      .withIndex("by_business_time", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(500);

    const todayActivity = allActivity.filter((a) => a.timestamp >= since);

    const classifications = todayActivity.filter((a) => a.type === "classification");
    const imageAnalyses = todayActivity.filter((a) => a.type === "image_analysis");
    const smartReplies = todayActivity.filter((a) => a.type === "smart_reply");
    const intentUpgrades = todayActivity.filter((a) => a.type === "intent_upgrade");
    const errors = todayActivity.filter((a) => a.type === "error");

    const avgConfidence =
      classifications.length > 0
        ? classifications.reduce((sum, c) => sum + (c.confidence || 0), 0) / classifications.length
        : 0;

    // Check if API keys are configured
    const groqConfigured = !!process.env.GROQ_API_KEY;
    const openaiConfigured = !!process.env.OPENAI_API_KEY;

    return {
      totalClassificationsToday: classifications.length,
      totalImageAnalysesToday: imageAnalyses.length,
      totalSmartRepliesToday: smartReplies.length,
      totalIntentUpgradesToday: intentUpgrades.length,
      totalErrorsToday: errors.length,
      avgConfidenceToday: Math.round(avgConfidence * 100),
      totalAllTime: allActivity.length,
      // Model status
      groqConfigured,
      openaiConfigured,
      llmModel: DEFAULT_GROQ_MODEL,
      visionModel: DEFAULT_VISION_MODEL,
    };
  },
});

// ─── Fallback reply builder (used when AI is disabled or fails) ──────────────

function buildFallbackReply(
  customerName: string,
  lastIntent: string | undefined,
  inboundContent: string
): string {
  if (lastIntent === "BUYING_SIGNAL") {
    return `Sure ${customerName}, I can help with that. Tell me the exact item, size, color, or budget you have in mind.`;
  }
  if (lastIntent === "GENERAL_INQUIRY") {
    return `Thanks ${customerName}. What product are you looking for today?`;
  }
  if (/(hello|hi|hey|good morning|good afternoon|good evening)/i.test(inboundContent)) {
    return `Hi ${customerName}, welcome! What product are you looking for today?`;
  }
  return `Thanks ${customerName}. I can help you choose quickly and place your order in chat. What are you looking for?`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA PIPELINE — Download → Cloudinary → Vision → React
// ═══════════════════════════════════════════════════════════════════════════════

/** Updates an interaction record with Cloudinary media URL + public ID. */
export const updateInteractionMedia = mutation({
  args: {
    interactionId: v.id("interactions"),
    mediaUrl: v.optional(v.string()),
    mediaId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.mediaUrl !== undefined) patch.mediaUrl = args.mediaUrl;
    if (args.mediaId !== undefined) patch.mediaId = args.mediaId;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.interactionId, patch);
    }
  },
});

/**
 * Full media message processing pipeline.
 *
 * Orchestrates:
 *   1. Download media from Evolution Go (decrypts WhatsApp encrypted media)
 *   2. Upload to Cloudinary (persistent, cost-efficient storage)
 *   3. Vision AI analysis for images/videos (OpenAI GPT-4o-mini)
 *   4. React with ✅ if payment proof is detected
 *   5. Mark inbound message as read (blue ticks)
 *
 * This action is scheduled from the webhook for ALL inbound media messages
 * (images, videos, audio, documents). Only images/videos get Vision analysis;
 * all types get downloaded and stored in Cloudinary.
 *
 * Fallback chain for media acquisition:
 *   A. Download via Evolution Go /message/downloadimage → base64 → Cloudinary
 *   B. If A fails, upload from URL via Cloudinary's remote fetch
 *   C. If B fails, use the direct URL for Vision (no Cloudinary persistence)
 */
export const processMediaMessage = action({
  args: {
    businessId: v.id("businesses"),
    sender: v.string(),
    whatsappMessageId: v.string(),
    messageKey: v.object({
      remoteJid: v.string(),
      fromMe: v.boolean(),
      id: v.string(),
    }),
    /** JSON-stringified raw message object from webhook (for Evolution Go download) */
    rawMessage: v.string(),
    messageType: v.string(),
    mimetype: v.string(),
    caption: v.optional(v.string()),
    fallbackMediaUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    cloudinaryUrl?: string;
    visionAnalysis?: string;
    isPaymentProof?: boolean;
  }> => {
    // ── Resolve business, customer, interaction ──
    const business = await ctx.runQuery(api.whatsapp.getBusinessForAssistantAuth, {
      businessId: args.businessId,
    });
    if (!business) {
      console.error("[processMediaMessage] Business not found:", args.businessId);
      return { success: false };
    }

    const instanceName = business.evolutionInstanceName;
    if (!instanceName) {
      console.error("[processMediaMessage] No Evolution Go instance for business:", args.businessId);
      return { success: false };
    }

    // Look up interaction by WhatsApp message ID
    const interaction = await ctx.runQuery(api.ai.getInteractionByWhatsappId, {
      whatsappMessageId: args.whatsappMessageId,
    });
    if (!interaction) {
      console.warn("[processMediaMessage] Interaction not found for message:", args.whatsappMessageId);
      return { success: false };
    }

    const customer = await ctx.runQuery(api.whatsapp.getCustomerLiteById, {
      customerId: interaction.customerId,
    });
    const customerName = customer?.name || args.sender.split("@")[0];

    const aiConfig = await ctx.runQuery(api.ai.getBusinessAIConfig, {
      businessId: args.businessId,
    });
    const visionModel = aiConfig?.aiVisionModel || DEFAULT_VISION_MODEL;

    // ── Step 1: Download media from Evolution Go ──
    let base64Data: string | null = null;
    let resolvedMimetype = args.mimetype;

    try {
      const rawMsg = JSON.parse(args.rawMessage);
      const downloaded = await evoClient.downloadMedia(instanceName, {
        key: {
          remoteJid: args.messageKey.remoteJid,
          id: args.messageKey.id,
          fromMe: args.messageKey.fromMe,
        },
        message: rawMsg,
      });
      base64Data = downloaded.base64;
      resolvedMimetype = downloaded.mimetype || args.mimetype;
      console.log(`[processMediaMessage] Downloaded media via Evolution Go (${resolvedMimetype}, ${base64Data.length} chars base64)`);
    } catch (downloadErr) {
      console.warn(
        "[processMediaMessage] Evolution Go download failed, trying Cloudinary URL upload:",
        downloadErr instanceof Error ? downloadErr.message : String(downloadErr)
      );
    }

    // ── Step 2: Upload to Cloudinary ──
    let cloudinaryUrl: string | null = null;
    let cloudinaryPublicId: string | null = null;

    const cloudinaryConfigured = cloudinary.isCloudinaryConfigured();

    if (cloudinaryConfigured && base64Data) {
      // Path A: Upload base64 to Cloudinary
      try {
        const uploaded = await cloudinary.uploadToCloudinary(base64Data, {
          mimetype: resolvedMimetype,
          folder: `pipelixr/${args.businessId}/${args.messageType}`,
          publicId: args.whatsappMessageId,
        });
        cloudinaryUrl = uploaded.secureUrl;
        cloudinaryPublicId = uploaded.publicId;
        console.log(`[processMediaMessage] Uploaded to Cloudinary: ${cloudinaryUrl}`);
      } catch (uploadErr) {
        console.warn(
          "[processMediaMessage] Cloudinary base64 upload failed:",
          uploadErr instanceof Error ? uploadErr.message : String(uploadErr)
        );
      }
    }

    if (cloudinaryConfigured && !cloudinaryUrl && args.fallbackMediaUrl) {
      // Path B: Let Cloudinary fetch from the direct URL
      try {
        const uploaded = await cloudinary.uploadToCloudinaryFromUrl(args.fallbackMediaUrl, {
          mimetype: resolvedMimetype,
          folder: `pipelixr/${args.businessId}/${args.messageType}`,
          publicId: args.whatsappMessageId,
        });
        cloudinaryUrl = uploaded.secureUrl;
        cloudinaryPublicId = uploaded.publicId;
        console.log(`[processMediaMessage] Uploaded to Cloudinary via URL: ${cloudinaryUrl}`);
      } catch (urlUploadErr) {
        console.warn(
          "[processMediaMessage] Cloudinary URL upload failed:",
          urlUploadErr instanceof Error ? urlUploadErr.message : String(urlUploadErr)
        );
      }
    }

    // Update interaction with Cloudinary URL (or fallback URL)
    const persistedUrl = cloudinaryUrl || args.fallbackMediaUrl;
    if (persistedUrl) {
      await ctx.runMutation(api.ai.updateInteractionMedia, {
        interactionId: interaction._id,
        mediaUrl: persistedUrl,
        mediaId: cloudinaryPublicId || undefined,
      });
    }

    // ── Step 3: Vision AI analysis (images & videos only) ──
    let visionAnalysis: string | undefined;
    let isPaymentProof = false;

    const shouldAnalyze =
      ["image", "video"].includes(args.messageType) &&
      aiConfig?.aiEnabled !== false &&
      !!process.env.OPENAI_API_KEY;

    if (shouldAnalyze) {
      // Determine the URL to send to OpenAI Vision
      // Priority: Cloudinary URL > base64 data URI > fallback URL
      let visionUrl: string | null = null;

      if (cloudinaryUrl) {
        visionUrl = cloudinaryUrl;
      } else if (base64Data) {
        // Send as data URI directly to OpenAI
        visionUrl = `data:${resolvedMimetype};base64,${base64Data}`;
      } else if (args.fallbackMediaUrl) {
        visionUrl = args.fallbackMediaUrl;
      }

      if (visionUrl) {
        try {
          const prompt = args.caption
            ? `${VISION_PROMPT}\n\nThe customer also sent this caption with the image: "${args.caption}"`
            : VISION_PROMPT;

          const raw = await callOpenAIVision(visionUrl, prompt, { model: visionModel });
          const parsed = parseImageAnalysis(raw);

          if (parsed) {
            visionAnalysis = JSON.stringify(parsed);
            isPaymentProof = parsed.isPaymentProof;

            // Update interaction with AI analysis
            await ctx.runMutation(api.ai.updateInteractionAI, {
              interactionId: interaction._id,
              imageAnalysis: visionAnalysis,
              aiProcessedAt: Date.now(),
              ...(parsed.isBuyingSignal
                ? { aiClassification: "BUYING_SIGNAL", aiConfidence: 0.85, aiReasoning: parsed.summary }
                : {}),
            });

            // Upgrade customer intent if buying signal detected
            if (parsed.isBuyingSignal) {
              await ctx.runMutation(api.ai.upgradeCustomerIntent, {
                businessId: args.businessId,
                customerId: interaction.customerId,
                newIntent: "BUYING_SIGNAL",
                interactionId: interaction._id,
              });
            }

            // Log to AI activity feed
            await ctx.runMutation(api.ai.logAIActivity, {
              businessId: args.businessId,
              type: "image_analysis",
              interactionId: interaction._id,
              customerId: interaction.customerId,
              customerName,
              summary: `Analyzed ${args.messageType} from ${customerName}: ${parsed.summary}`,
              details: visionAnalysis,
              model: visionModel,
              confidence: parsed.isBuyingSignal ? 0.9 : 0.7,
              timestamp: Date.now(),
            });

            // ── Step 4: React with ✅ if payment proof detected ──
            if (parsed.isPaymentProof) {
              console.log(`[processMediaMessage] Payment proof detected from ${customerName} — reacting ✅`);
              await evoClient.reactToMessage(
                instanceName,
                {
                  remoteJid: args.messageKey.remoteJid,
                  fromMe: args.messageKey.fromMe,
                  id: args.messageKey.id,
                },
                "✅"
              );
            }
          }
        } catch (visionErr) {
          console.error("[processMediaMessage] Vision analysis error:", visionErr);
          await ctx.runMutation(api.ai.logAIActivity, {
            businessId: args.businessId,
            type: "error",
            interactionId: interaction._id,
            customerId: interaction.customerId,
            customerName,
            summary: `${args.messageType} analysis failed: ${visionErr instanceof Error ? visionErr.message : "Unknown error"}`,
            model: visionModel,
            timestamp: Date.now(),
          });
        }
      }
    }

    // ── Step 5: Mark inbound message as read ──
    await evoClient.markAsRead(instanceName, [
      {
        remoteJid: args.messageKey.remoteJid,
        fromMe: args.messageKey.fromMe,
        id: args.messageKey.id,
      },
    ]);

    return {
      success: true,
      cloudinaryUrl: cloudinaryUrl || undefined,
      visionAnalysis,
      isPaymentProof,
    };
  },
});

/** Looks up an interaction by its WhatsApp message ID. */
export const getInteractionByWhatsappId = query({
  args: { whatsappMessageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("interactions")
      .withIndex("by_whatsapp_id", (q) => q.eq("whatsappMessageId", args.whatsappMessageId))
      .first();
  },
});
