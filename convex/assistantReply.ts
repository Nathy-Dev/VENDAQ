import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { decryptSecret } from "./lib/crypto";
import { assistantReplyDelayMs, BUSINESS_SYSTEM_PROMPT_MIN_LENGTH } from "./lib/launch";
import { foundationPolicy } from "./lib/policy";
import { providerSendResult, sendAuthorizedAssistantText, showAuthorizedAssistantTyping } from "./lib/evolution";
import { groupMayAutoReply } from "./lib/groupGovernance";

const candidate = v.object({
  businessId: v.id("businesses"),
  interactionId: v.id("interactions"),
  customerId: v.id("customers"),
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
    if (!interaction || interaction.role !== "customer" || interaction.manualReviewRequired || !["text", "audio"].includes(interaction.messageType ?? "")) return null;
    const existing = await ctx.db.query("assistantDispatches").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).unique();
    if (existing) return null;
    const [business, customer, session] = await Promise.all([
      ctx.db.get(interaction.businessId),
      ctx.db.get(interaction.customerId),
      interaction.sessionId ? ctx.db.get(interaction.sessionId) : null,
    ]);
    if (!business || business.foundationVersion !== 1 || !customer || !session || session.state !== "connected" || !session.providerInstanceId) return null;
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

export const recentConversation = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.array(v.object({ role: v.union(v.literal("customer"), v.literal("owner"), v.literal("system")), content: v.string() })),
  handler: async (ctx, args) => {
    const messages = await ctx.db.query("interactions").withIndex("by_customer", (builder) => builder.eq("customerId", args.customerId)).order("desc").take(8);
    return messages.reverse().map((message) => ({ role: message.role, content: message.content.slice(0, 2_000) }));
  },
});

export const reserve = internalMutation({
  args: { interactionId: v.id("interactions"), content: v.string() },
  returns: v.union(v.null(), v.id("assistantDispatches")),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.role !== "customer" || interaction.manualReviewRequired || !["text", "audio"].includes(interaction.messageType ?? "") || !interaction.sessionId) return null;
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
      content: args.content,
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
      }
      const missed = await ctx.db.query("missedRevenueOpportunities").withIndex("by_interaction", (builder) => builder.eq("interactionId", dispatch.interactionId)).unique();
      if (missed && missed.state !== "answered") {
        if (missed.scheduledId) { const scheduled = await ctx.db.system.get(missed.scheduledId); if (scheduled?.state.kind === "pending") await ctx.scheduler.cancel(missed.scheduledId); }
        await ctx.db.patch(missed._id, { state: "answered", answeredAt: now });
      }
      const opportunity = await ctx.db.query("communityOpportunities").withIndex("by_interaction", (builder) => builder.eq("interactionId", dispatch.interactionId)).unique();
      if (opportunity && opportunity.state === "open") await ctx.db.patch(opportunity._id, { state: "in_progress", updatedAt: now });
      await ctx.db.insert("aiActivityLog", { businessId: dispatch.businessId, type: "smart_reply", interactionId, customerId: dispatch.customerId, summary: dispatch.isGroup ? "Replied in an authorized WhatsApp group" : "Replied to a customer on WhatsApp", model: process.env.GROQ_LLM_MODEL?.trim() || "configured-model", timestamp: now });
    }
    return null;
  },
});

async function generateReply(systemPrompt: string, customerName: string, inboundContent: string, history: Array<{ role: "customer" | "owner" | "system"; content: string }>): Promise<string> {
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
          { role: "system", content: `${systemPrompt}\n\nChannel rules: Reply as the business on WhatsApp. Use plain text only. Keep the reply concise and accurate. Never claim you completed an action you cannot verify. Never invent prices, stock, delivery times, policies, or payment details. If the business prompt does not contain the answer, ask one short clarifying question or say a human will confirm.` },
          ...history.map((message) => ({ role: message.role === "owner" ? "assistant" as const : message.role === "customer" ? "user" as const : "system" as const, content: message.content })),
          { role: "user", content: `${customerName} just sent: ${inboundContent}\nReturn only the WhatsApp reply.` },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("AI_GENERATION_FAILED");
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = result.choices?.[0]?.message?.content?.trim().replace(/^['\"]|['\"]$/g, "") ?? "";
    if (reply.length < 2 || reply.length > 1_000) throw new Error("AI_GENERATION_FAILED");
    return reply;
  } finally {
    clearTimeout(timeout);
  }
}

export const prepareForInteraction = internalAction({
  args: { interactionId: v.id("interactions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await ctx.runQuery(internal.assistantReply.candidateForInteraction, args);
    if (!current) return null;
    try {
      const history = await ctx.runQuery(internal.assistantReply.recentConversation, { customerId: current.customerId });
      const content = await generateReply(current.systemPrompt, current.customerName, current.inboundContent, history);
      const dispatchId = await ctx.runMutation(internal.assistantReply.reserve, { interactionId: current.interactionId, content });
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
    if (!interaction || interaction.businessId !== business._id || interaction.customerId !== dispatch.customerId || interaction.sessionId !== session._id || interaction.role !== "customer") return null;
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
