import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { Agent } from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { decryptSecret } from "./lib/crypto";
import { assistantReplyDelayMs, BUSINESS_SYSTEM_PROMPT_MIN_LENGTH } from "./lib/launch";
import { foundationPolicy } from "./lib/policy";
import { providerSendResult, sendAuthorizedAssistantText, showAuthorizedAssistantTyping } from "./lib/evolution";
import { groupMayAutoReply } from "./lib/groupGovernance";
import { CUSTOMER_SPEECH_STYLE_RULES, normalizeAssistantReply } from "./lib/assistantStyle";

const candidate = v.object({
  businessId: v.id("businesses"),
  interactionId: v.id("interactions"),
  customerId: v.id("customers"),
  conversationId: v.union(v.id("conversations"), v.null()),
  agentThreadId: v.union(v.string(), v.null()),
  sessionId: v.id("whatsappSessions"),
  target: v.string(),
  customerName: v.string(),
  inboundContent: v.string(),
  systemPrompt: v.string(),
  isGroup: v.boolean(),
  tokenCiphertext: v.string(),
  providerInstanceId: v.string(),
});

export const candidateForInteraction = internalQuery({
  args: { interactionId: v.id("interactions") },
  returns: v.union(v.null(), candidate),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.role !== "customer" || interaction.manualReviewRequired || !["text", "audio", "image"].includes(interaction.messageType ?? "")) return null;
    if (interaction.messageType === "image" && (interaction.imageAnalysisState !== "completed" || !interaction.imageAnalysis?.trim())) return null;
    const existing = await ctx.db.query("assistantDispatches").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).unique();
    if (existing) return null;
    const [business, customer, session] = await Promise.all([
      ctx.db.get(interaction.businessId),
      ctx.db.get(interaction.customerId),
      interaction.sessionId ? ctx.db.get(interaction.sessionId) : null,
    ]);
    const conversation = interaction.conversationId ? await ctx.db.get(interaction.conversationId) : null;
    if (!business || business.foundationVersion !== 1 || !customer || !session || session.state !== "connected" || !session.providerInstanceId) return null;
    if (conversation && (conversation.businessId !== business._id || conversation.customerId !== customer._id)) return null;
    let systemPrompt = business.businessSystemPrompt?.trim() ?? "";
    if (systemPrompt.length < BUSINESS_SYSTEM_PROMPT_MIN_LENGTH || (business.killSwitch ?? true)) return null;
    const isGroup = interaction.isGroup ?? customer.isGroup ?? false;
    if (isGroup) {
      if (!(business.groupAutoReplyEnabled ?? false)) return null;
      const group = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", business._id).eq("groupJid", customer.phone)).unique();
      if (!group || !groupMayAutoReply(group, interaction)) return null;
      if (group.customInstructions?.trim()) systemPrompt += `\n\nRules for this WhatsApp group:\n${group.customInstructions.trim()}`;
      systemPrompt += "\n\nGroup privacy rule: Never message a participant privately, request private details, or claim a private handoff has happened unless the participant explicitly agrees in the group and the business owner completes that handoff.";
    } else if (!(business.customerAutoReplyEnabled ?? false)) {
      return null;
    }
    return {
      businessId: business._id,
      interactionId: interaction._id,
      customerId: customer._id,
      conversationId: conversation?._id ?? null,
      agentThreadId: conversation?.agentThreadId ?? null,
      sessionId: session._id,
      target: customer.phone,
      customerName: customer.name ?? (isGroup ? "the group" : "customer"),
      inboundContent: interaction.content,
      systemPrompt,
      isGroup,
      tokenCiphertext: session.tokenCiphertext,
      providerInstanceId: session.providerInstanceId,
    };
  },
});

export const attachAgentThread = internalMutation({
  args: { conversationId: v.id("conversations"), threadId: v.string() },
  returns: v.object({ threadId: v.string(), attached: v.boolean() }),
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return { threadId: args.threadId, attached: false };
    if (conversation.agentThreadId) return { threadId: conversation.agentThreadId, attached: conversation.agentThreadId === args.threadId };
    await ctx.db.patch(conversation._id, { agentThreadId: args.threadId.slice(0, 200) });
    return { threadId: args.threadId, attached: true };
  },
});

export const recentConversation = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.array(v.object({ role: v.union(v.literal("customer"), v.literal("owner"), v.literal("system")), content: v.string() })),
  handler: async (ctx, args) => {
    const messages = await ctx.db.query("interactions").withIndex("by_customer", (builder) => builder.eq("customerId", args.customerId)).order("desc").take(8);
    return messages.reverse().map((message) => ({ role: message.role, content: message.content.slice(0, 2_000) }));
  },
});

export const reserve = internalMutation({
  args: { interactionId: v.id("interactions"), content: v.string(), qualificationQuestionField: v.optional(v.union(v.literal("need"), v.literal("budget"), v.literal("location"), v.literal("timeline"), v.literal("readiness"))) },
  returns: v.union(v.null(), v.id("assistantDispatches")),
  handler: async (ctx, args) => {
    const content = normalizeAssistantReply(args.content);
    if (content.length < 2 || content.length > 1_000) return null;
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.role !== "customer" || interaction.manualReviewRequired || !["text", "audio", "image"].includes(interaction.messageType ?? "") || !interaction.sessionId) return null;
    if (interaction.messageType === "image" && (interaction.imageAnalysisState !== "completed" || !interaction.imageAnalysis?.trim())) return null;
    const existing = await ctx.db.query("assistantDispatches").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).unique();
    if (existing) return null;
    const customer = await ctx.db.get(interaction.customerId);
    const business = await ctx.db.get(interaction.businessId);
    const session = await ctx.db.get(interaction.sessionId);
    if (!customer || customer.businessId !== interaction.businessId || !business || business.foundationVersion !== 1 || !session || session.businessId !== business._id || session.state !== "connected" || !session.providerInstanceId || (business.killSwitch ?? true)) return null;
    if ((business.businessSystemPrompt?.trim().length ?? 0) < BUSINESS_SYSTEM_PROMPT_MIN_LENGTH) return null;
    const isGroup = interaction.isGroup ?? customer.isGroup ?? false;
    if (isGroup) {
      if (!(business.groupAutoReplyEnabled ?? false)) return null;
      const group = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", business._id).eq("groupJid", customer.phone)).unique();
      if (!group || !groupMayAutoReply(group, interaction)) return null;
    } else if (!(business.customerAutoReplyEnabled ?? false)) {
      return null;
    }
    const now = Date.now();
    const since = now - 86_400_000;
    const daily = await ctx.db.query("assistantDispatches").withIndex("by_business_time", (builder) => builder.eq("businessId", business._id).gte("createdAt", since)).take(foundationPolicy().assistantDailySendCap);
    if (daily.length >= foundationPolicy().assistantDailySendCap) return null;
    const targetCooldownAt = now - foundationPolicy().assistantTargetCooldownSeconds * 1_000;
    const recentTarget = await ctx.db.query("assistantDispatches").withIndex("by_business_target_time", (builder) => builder.eq("businessId", business._id).eq("target", customer.phone).gte("createdAt", targetCooldownAt)).take(1);
    if (recentTarget.length) return null;
    return await ctx.db.insert("assistantDispatches", {
      businessId: business._id,
      interactionId: interaction._id,
      customerId: customer._id,
      sessionId: session._id,
      target: customer.phone,
      isGroup,
      content,
      qualificationQuestionField: args.qualificationQuestionField,
      state: "reserved",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markSubmitting = internalMutation({
  args: { dispatchId: v.id("assistantDispatches") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);
    if (!dispatch || dispatch.state !== "reserved") return false;
    await ctx.db.patch(dispatch._id, { state: "submitting", attempts: 1, updatedAt: Date.now() });
    return true;
  },
});

export const cancelBeforeSubmit = internalMutation({
  args: { dispatchId: v.id("assistantDispatches"), errorCode: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);
    if (!dispatch || dispatch.state !== "submitting") return null;
    await ctx.db.patch(dispatch._id, { state: "cancelled", errorCode: args.errorCode, updatedAt: Date.now() });
    return null;
  },
});

export const finish = internalMutation({
  args: { dispatchId: v.id("assistantDispatches"), state: v.union(v.literal("accepted"), v.literal("failed"), v.literal("unknown"), v.literal("cancelled")), providerMessageId: v.optional(v.string()), errorCode: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);
    if (!dispatch || !["reserved", "submitting"].includes(dispatch.state)) return null;
    await ctx.db.patch(dispatch._id, { state: args.state, providerMessageId: args.providerMessageId, errorCode: args.errorCode, updatedAt: Date.now() });
    if (args.state === "accepted") {
      const now = Date.now();
      const inbound = await ctx.db.get(dispatch.interactionId);
      const interactionId = await ctx.db.insert("interactions", { businessId: dispatch.businessId, customerId: dispatch.customerId, ...(inbound?.conversationId ? { conversationId: inbound.conversationId } : {}), sessionId: dispatch.sessionId, role: "owner", content: dispatch.content, timestamp: now, receivedAt: now, isGroup: dispatch.isGroup, messageType: "text", aiProcessedAt: now, expiresAt: now + foundationPolicy().messageRetentionDays * 86_400_000 });
      const customer = await ctx.db.get(dispatch.customerId);
      if (customer) await ctx.db.patch(customer._id, { lastInteraction: Math.max(customer.lastInteraction, now), lastOutboundAt: now });
      if (inbound?.conversationId) {
        const conversation = await ctx.db.get(inbound.conversationId);
        if (conversation) await ctx.db.patch(conversation._id, { revision: conversation.revision + 1, lastEventAt: Math.max(conversation.lastEventAt, now), lastOwnerAt: Math.max(conversation.lastOwnerAt ?? 0, now), messageCount: conversation.messageCount + 1 });
        if (dispatch.qualificationQuestionField) await ctx.scheduler.runAfter(0, internal.leadQualification.recordQuestionAsked, { conversationId: inbound.conversationId, field: dispatch.qualificationQuestionField, askedAt: now });
      }
      const missed = await ctx.db.query("missedRevenueOpportunities").withIndex("by_interaction", (builder) => builder.eq("interactionId", dispatch.interactionId)).unique();
      if (missed && missed.state !== "answered") {
        if (missed.scheduledId) { const scheduled = await ctx.db.system.get(missed.scheduledId); if (scheduled?.state.kind === "pending") await ctx.scheduler.cancel(missed.scheduledId); }
        await ctx.db.patch(missed._id, { state: "answered", answeredAt: now });
      }
      const opportunity = await ctx.db.query("communityOpportunities").withIndex("by_interaction", (builder) => builder.eq("interactionId", dispatch.interactionId)).unique();
      if (opportunity && opportunity.state === "open") await ctx.db.patch(opportunity._id, { state: "in_progress", updatedAt: now });
      if (!dispatch.isGroup) await ctx.scheduler.runAfter(0, internal.commerceIntelligence.captureFromInteraction, { interactionId });
      await ctx.db.insert("aiActivityLog", { businessId: dispatch.businessId, type: "smart_reply", interactionId, customerId: dispatch.customerId, summary: dispatch.isGroup ? "Replied in an authorized WhatsApp group" : "Replied to a customer on WhatsApp", model: process.env.GROQ_LLM_MODEL?.trim() || "configured-model", timestamp: now });
    }
    return null;
  },
});

type AssistantContext = {
  knowledge: Array<{ title: string; kind: string; content: string; confidence: number; verifiedAt: number | null }>;
  memories: Array<{ key: string; value: string; state: string; confidence: number }>;
  commitments: Array<{ kind: string; actor: string; summary: string; dueAt: number | null }>;
  exceptions: Array<{ kind: string; severity: string; summary: string; state: string }>;
  negotiation: { maximumDiscountPercent: number; minimumPrice: number | null; freeDeliveryThreshold: number | null; requireApprovalBelow: number | null } | null;
  payment: { receiptState: string; verificationState: string; reason: string | null } | null;
};

function intelligencePrompt(context: AssistantContext): string {
  const knowledge = context.knowledge.length ? context.knowledge.map((item) => `- [${item.kind}] ${item.title}: ${item.content}`).join("\n") : "- No separately approved business facts are available.";
  const memories = context.memories.length ? context.memories.map((item) => `- ${item.key}: ${item.value}`).join("\n") : "- No verified customer memory.";
  const commitments = context.commitments.length ? context.commitments.map((item) => `- ${item.actor} promised: ${item.summary}${item.dueAt ? `, due ${new Date(item.dueAt).toISOString()}` : ""}`).join("\n") : "- No open promises.";
  const exceptions = context.exceptions.length ? context.exceptions.map((item) => `- ${item.severity} ${item.kind}: ${item.summary}, state ${item.state}`).join("\n") : "- No open issue.";
  const negotiation = context.negotiation ? `Maximum discount: ${context.negotiation.maximumDiscountPercent}%. Minimum price: ${context.negotiation.minimumPrice ?? "not set"}. Free delivery threshold: ${context.negotiation.freeDeliveryThreshold ?? "not set"}. Owner approval below: ${context.negotiation.requireApprovalBelow ?? "not set"}.` : "No approved negotiation flexibility is set. Do not offer a discount, lower price, free delivery, or special bundle unless the business system prompt explicitly authorizes it.";
  const payment = context.payment ? `Latest receipt state: ${context.payment.receiptState}. Independent verification: ${context.payment.verificationState}. ${context.payment.reason ?? ""}` : "No payment evidence is being reviewed.";
  return `Approved business knowledge, use only when relevant:\n${knowledge}\n\nVerified customer memory, never mention that memory is stored:\n${memories}\n\nOpen promises that must not be forgotten:\n${commitments}\n\nOpen customer issues:\n${exceptions}\n\nNegotiation boundaries:\n${negotiation}\n\nPayment safety:\n${payment}`;
}

function hasKnowledgeConflict(context: AssistantContext): boolean {
  const values = new Map<string, string>();
  for (const item of context.knowledge) {
    const key = `${item.kind}:${item.title.trim().toLowerCase()}`;
    const value = item.content.trim().toLowerCase();
    const existing = values.get(key);
    if (existing && existing !== value) return true;
    values.set(key, value);
  }
  return false;
}

function generatedNeedsOwner(reply: string, inbound: string): boolean {
  if (!/[?]|\b(price|stock|available|availability|delivery|refund|return|warranty|discount|payment|account)\b/i.test(inbound)) return false;
  return /\b(i|we)(?:'ll| will)?\s+(?:check|confirm|verify|get back)|\b(?:owner|team|human)\s+will\s+(?:check|confirm)|\blet me (?:check|confirm|verify)\b/i.test(reply);
}

function replyAsksQualificationField(reply: string, field: "need" | "budget" | "location" | "timeline" | "readiness"): boolean {
  if (!reply.includes("?")) return false;
  const patterns = {
    need: /\b(what|which|wetin|tell me).{0,45}\b(need|want|looking for|service|product|help with)\b/i,
    budget: /\b(budget|price range|how much.{0,20}(spend|pay)|amount.{0,20}(spend|pay))\b/i,
    location: /\b(where|which location|what location|location|area|state|city|deliver to|send to)\b/i,
    timeline: /\b(when|what date|which date|how soon|timeline|need it|delivery date)\b/i,
    readiness: /\b(ready|go ahead|proceed|place.{0,15}order|book now|confirm now)\b/i,
  } satisfies Record<typeof field, RegExp>;
  return patterns[field].test(reply);
}

async function generateGroqReply(systemPrompt: string, customerName: string, inboundContent: string, history: Array<{ role: "customer" | "owner" | "system"; content: string }>): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_LLM_MODEL?.trim();
  if (!apiKey || !model) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 260,
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map((message) => ({ role: message.role === "owner" ? "assistant" as const : message.role === "customer" ? "user" as const : "system" as const, content: message.content })),
          { role: "user", content: `${customerName} just sent: ${inboundContent}\nReturn only the WhatsApp reply.` },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("AI_GENERATION_FAILED");
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = normalizeAssistantReply(result.choices?.[0]?.message?.content ?? "");
    if (reply.length < 2 || reply.length > 1_000) throw new Error("AI_GENERATION_FAILED");
    return reply;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateAgentReply(ctx: Parameters<typeof internalAction>[0] extends never ? never : any, args: {
  systemPrompt: string;
  customerName: string;
  inboundContent: string;
  businessId: string;
  customerId: string;
  conversationId: string | null;
  agentThreadId: string | null;
}): Promise<string> {
  const model = process.env.CONVEX_AI_GATEWAY_MODEL?.trim();
  if (!model) throw new Error("AI_GATEWAY_NOT_CONFIGURED");
  const agent = new Agent(components.agent, {
    name: "pipelixr-whatsapp-assistant",
    languageModel: convexGateway(model, { zdr: true }),
  });
  const userId = `business:${args.businessId}:customer:${args.customerId}`;
  let threadId = args.agentThreadId;
  if (!threadId && args.conversationId) {
    const created = await agent.createThread(ctx, { userId, title: `${args.customerName} WhatsApp conversation` });
    const attached = await ctx.runMutation(internal.assistantReply.attachAgentThread, { conversationId: args.conversationId, threadId: created.threadId });
    threadId = attached.threadId;
    if (!attached.attached && created.threadId !== threadId) await agent.deleteThreadAsync(ctx, { threadId: created.threadId });
  }
  if (!threadId) throw new Error("AI_THREAD_NOT_AVAILABLE");
  const result = await agent.generateText(ctx, { threadId, userId }, {
    system: args.systemPrompt,
    prompt: `${args.customerName} just sent: ${args.inboundContent}\nReturn only the WhatsApp reply.`,
    temperature: 0.35,
    maxOutputTokens: 260,
  }, {
    contextOptions: { recentMessages: 12 },
    storageOptions: { saveMessages: "promptAndOutput" },
  });
  const reply = normalizeAssistantReply(result.text);
  if (reply.length < 2 || reply.length > 1_000) throw new Error("AI_GENERATION_FAILED");
  return reply;
}

export const prepareForInteraction = internalAction({
  args: { interactionId: v.id("interactions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await ctx.runQuery(internal.assistantReply.candidateForInteraction, args);
    if (!current) return null;
    try {
      const qualification = current.isGroup ? null : await ctx.runAction(internal.leadQualification.analyzeInteraction, { interactionId: current.interactionId });
      const gate = await ctx.runQuery(internal.commerceIntelligence.gateForAssistant, { interactionId: current.interactionId });
      if (gate) {
        const dispatchId = await ctx.runMutation(internal.assistantReply.reserve, { interactionId: current.interactionId, content: gate.holdingReply });
        if (dispatchId) await ctx.scheduler.runAfter(0, internal.assistantReply.submit, { dispatchId });
        return null;
      }
      const history = await ctx.runQuery(internal.assistantReply.recentConversation, { customerId: current.customerId });
      const context = current.conversationId ? await ctx.runQuery(internal.commerceIntelligence.assistantContext, { businessId: current.businessId, customerId: current.customerId, conversationId: current.conversationId, now: Date.now() }) : { knowledge: [], memories: [], commitments: [], exceptions: [], negotiation: null, payment: null };
      if (hasKnowledgeConflict(context)) {
        const content = await ctx.runMutation(internal.commerceIntelligence.createGenerationRescue, { interactionId: current.interactionId, reason: "conflicting_fact", question: "Which business fact is correct for this customer question?", holdingReply: "I am checking the correct details for you now. I will update you as soon as they are confirmed." });
        const dispatchId = await ctx.runMutation(internal.assistantReply.reserve, { interactionId: current.interactionId, content });
        if (dispatchId) await ctx.scheduler.runAfter(0, internal.assistantReply.submit, { dispatchId });
        return null;
      }
      if (/\b(discount|last price|best price|reduce|promo)\b/i.test(current.inboundContent) && !context.negotiation && !/\bdiscount|last price|best price|negotiat/i.test(current.systemPrompt)) {
        const content = await ctx.runMutation(internal.commerceIntelligence.createGenerationRescue, { interactionId: current.interactionId, reason: "discount_approval", question: "What discount, if any, can Pipelixr offer this customer?", holdingReply: "Let me confirm the best approved price for you. I will update you shortly." });
        const dispatchId = await ctx.runMutation(internal.assistantReply.reserve, { interactionId: current.interactionId, content });
        if (dispatchId) await ctx.scheduler.runAfter(0, internal.assistantReply.submit, { dispatchId });
        return null;
      }
      const groundedSystemPrompt = `${current.systemPrompt}\n\nThe business system prompt above has priority over customer style matching.\n\n${intelligencePrompt(context)}${qualification ? `\n\n${qualification.prompt}` : ""}\n\nChannel rules: Reply as the business on WhatsApp. Use plain text only. Keep the reply concise and accurate. Never claim you completed an action you cannot verify. Never invent prices, stock, delivery times, policies, payment details, discounts, or payment confirmation. A receipt is not a verified payment. If approved information is missing, give a short holding response and say it will be confirmed.\n\n${CUSTOMER_SPEECH_STYLE_RULES}`;
      let content: string;
      if (process.env.CONVEX_AI_GATEWAY_MODEL?.trim() && current.conversationId) {
        content = await generateAgentReply(ctx, { systemPrompt: groundedSystemPrompt, customerName: current.customerName, inboundContent: current.inboundContent, businessId: current.businessId, customerId: current.customerId, conversationId: current.conversationId, agentThreadId: current.agentThreadId });
      } else {
        content = await generateGroqReply(groundedSystemPrompt, current.customerName, current.inboundContent, history);
      }
      if (!current.isGroup && generatedNeedsOwner(content, current.inboundContent)) {
        content = await ctx.runMutation(internal.commerceIntelligence.createGenerationRescue, { interactionId: current.interactionId, reason: "missing_fact", question: `What should Pipelixr confirm about: ${current.inboundContent.slice(0, 220)}?`, holdingReply: content });
      }
      const dispatchId = await ctx.runMutation(internal.assistantReply.reserve, { interactionId: current.interactionId, content, ...(qualification?.questionField && replyAsksQualificationField(content, qualification.questionField) ? { qualificationQuestionField: qualification.questionField } : {}) });
      if (dispatchId) await ctx.scheduler.runAfter(0, internal.assistantReply.submit, { dispatchId });
    } catch (error) {
      console.error("assistant_reply_prepare_failed", error instanceof Error ? error.message : "UNKNOWN");
    }
    return null;
  },
});

export const submit = internalAction({
  args: { dispatchId: v.id("assistantDispatches") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const dispatch = await ctx.runMutation(internal.assistantReply.markSubmitting, args);
    if (!dispatch) return null;
    const record = await ctx.runQuery(internal.assistantReply.dispatchForSubmit, args);
    if (!record) {
      await ctx.runMutation(internal.assistantReply.cancelBeforeSubmit, { dispatchId: args.dispatchId, errorCode: "AUTHORIZATION_REVOKED_BEFORE_SUBMIT" });
      return null;
    }
    try {
      const token = await decryptSecret(record.tokenCiphertext, `business:${record.businessId}:session-token`);
      const delayMs = assistantReplyDelayMs(record.content.length, record.interactionId);
      try {
        // Evolution Go keeps the composing indicator alive for this bounded
        // delay and clears it before returning. Failure is non-fatal: the
        // assistant may still send, but consent is revalidated again below.
        await showAuthorizedAssistantTyping({ token, instanceId: record.providerInstanceId, target: record.target, delayMs });
      } catch (error) {
        console.error("assistant_typing_failed", error instanceof Error ? error.message : "UNKNOWN");
      }
      const revalidated = await ctx.runQuery(internal.assistantReply.dispatchForSubmit, args);
      if (!revalidated) {
        await ctx.runMutation(internal.assistantReply.cancelBeforeSubmit, { dispatchId: args.dispatchId, errorCode: "AUTHORIZATION_REVOKED_DURING_TYPING" });
        return null;
      }
      const currentToken = await decryptSecret(revalidated.tokenCiphertext, `business:${revalidated.businessId}:session-token`);
      const result = await sendAuthorizedAssistantText({ token: currentToken, instanceId: revalidated.providerInstanceId, target: revalidated.target, content: revalidated.content, interactionId: revalidated.interactionId });
      const provider = providerSendResult(result);
      await ctx.runMutation(internal.assistantReply.finish, { dispatchId: args.dispatchId, state: "accepted", ...(provider.messageId ? { providerMessageId: provider.messageId } : {}) });
    } catch (error) {
      const code = error instanceof Error ? error.message : "SEND_FAILED";
      const state = ["PROVIDER_NOT_CONFIGURED", "PROVIDER_DISABLED", "INSECURE_PROVIDER_URL", "INVALID_PROVIDER_URL", "INVALID_PROVIDER_AUTH_MODE", "PROVIDER_AUTH_FAILED"].includes(code) ? "failed" as const : "unknown" as const;
      await ctx.runMutation(internal.assistantReply.finish, { dispatchId: args.dispatchId, state, errorCode: code });
    }
    return null;
  },
});

export const dispatchForSubmit = internalQuery({
  args: { dispatchId: v.id("assistantDispatches") },
  returns: v.union(v.null(), v.object({ businessId: v.id("businesses"), interactionId: v.id("interactions"), target: v.string(), content: v.string(), tokenCiphertext: v.string(), providerInstanceId: v.string() })),
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);
    if (!dispatch || dispatch.state !== "submitting") return null;
    const [business, session, interaction, customer] = await Promise.all([
      ctx.db.get(dispatch.businessId),
      ctx.db.get(dispatch.sessionId),
      ctx.db.get(dispatch.interactionId),
      ctx.db.get(dispatch.customerId),
    ]);
    if (!business || business.foundationVersion !== 1 || !session || session.businessId !== business._id || session.state !== "connected" || !session.providerInstanceId || (business.killSwitch ?? true)) return null;
    if (!interaction || interaction.businessId !== business._id || interaction.customerId !== dispatch.customerId || interaction.sessionId !== session._id || interaction.role !== "customer" || interaction.manualReviewRequired) return null;
    if (interaction.messageType === "image" && (interaction.imageAnalysisState !== "completed" || !interaction.imageAnalysis?.trim())) return null;
    if (!customer || customer.businessId !== business._id || customer.phone !== dispatch.target || (business.businessSystemPrompt?.trim().length ?? 0) < BUSINESS_SYSTEM_PROMPT_MIN_LENGTH) return null;
    const isGroup = interaction.isGroup ?? customer.isGroup ?? false;
    if (isGroup !== dispatch.isGroup) return null;
    if (isGroup) {
      if (!(business.groupAutoReplyEnabled ?? false)) return null;
      const group = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", business._id).eq("groupJid", customer.phone)).unique();
      if (!group || !groupMayAutoReply(group, interaction)) return null;
    } else if (!(business.customerAutoReplyEnabled ?? false)) {
      return null;
    }
    return { businessId: business._id, interactionId: dispatch.interactionId, target: dispatch.target, content: dispatch.content, tokenCiphertext: session.tokenCiphertext, providerInstanceId: session.providerInstanceId };
  },
});
