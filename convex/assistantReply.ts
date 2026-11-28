import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { Agent } from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { wrapLanguageModel } from "ai";
import { decryptSecret } from "./lib/crypto";
import { assistantReplyDelayMs, BUSINESS_SYSTEM_PROMPT_MIN_LENGTH } from "./lib/launch";
import { foundationPolicy } from "./lib/policy";
import { canSendServiceMessage } from "./lib/compliance";
import { providerSendResult, sendAuthorizedAssistantText, showAuthorizedAssistantTyping } from "./lib/evolution";
import { groupMayAutoReply } from "./lib/groupGovernance";
import { CUSTOMER_SPEECH_STYLE_RULES, normalizeAssistantReply } from "./lib/assistantStyle";
import { reserveAssistedConversation } from "./lib/billingAccess";
import { billingAccess } from "./lib/billingAccess";
import { recordDuplicateDispatch, recordResponseTime } from "./productAnalytics";
import { canProcessInboxMessage } from "./lib/inboxAi";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Doc } from "./_generated/dataModel";
import { metaRecipient, MetaError, sendMetaText, META_SERVICE_WINDOW_MS } from "./lib/meta";
import { requireBusiness } from "./lib/authorization";

const sellerReplyArgs = { businessId: v.id("businesses"), customerId: v.id("customers") };
const sellerReplyState = v.union(v.literal("queued"), v.literal("accepted"), v.literal("sent"), v.literal("delivered"), v.literal("read"), v.literal("failed"), v.literal("unknown"), v.literal("cancelled"));
const metaDispatchDeadline = 60_000;

async function sellerReplyTarget(ctx: QueryCtx | MutationCtx, business: Doc<"businesses">, customer: Doc<"customers">, session?: Doc<"whatsappSessions"> | null) {
  if (process.env.META_WHATSAPP_SEND_ENABLED !== "true" || customer.businessId !== business._id || customer.isGroup || !metaRecipient(customer.phone)) return null;
  const binding = session ?? await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique();
  if (!binding || binding.businessId !== business._id || binding.provider !== "meta" || binding.state !== "connected" || !binding.providerInstanceId) return null;
  const conversation = await ctx.db.query("conversations").withIndex("by_customer", (builder) => builder.eq("customerId", customer._id)).first();
  const inboundAt = conversation?.metaInboundAt;
  if (!conversation || conversation.businessId !== business._id || conversation.metaInboundGeneration !== binding.generation || !inboundAt || inboundAt <= Date.now() - META_SERVICE_WINDOW_MS || !await canSendServiceMessage(ctx, customer)) return null;
  const access = await billingAccess(ctx, business);
  if (!access.canUsePaidFeatures || access.readOnly) return null;
  return { binding, conversation, expiresAt: inboundAt + META_SERVICE_WINDOW_MS };
}

export const sellerReplyInfo = query({
  args: sellerReplyArgs,
  returns: v.object({ expiresAt: v.union(v.number(), v.null()), latest: v.union(sellerReplyState, v.null()) }),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== business._id || customer.deletedAt !== undefined) throw new ConvexError({ code: "NOT_FOUND" });
    const target = await sellerReplyTarget(ctx, business, customer);
    const latest = await ctx.db.query("assistantDispatches").withIndex("by_customer_kind", (builder) => builder.eq("customerId", customer._id).eq("kind", "seller_reply")).order("desc").first();
    return { expiresAt: target?.expiresAt ?? null, latest: latest?.metaDeliveryState ?? (latest?.state === "reserved" || latest?.state === "submitting" ? "queued" as const : latest?.state ?? null) };
  },
});

export const queueSellerReply = mutation({
  args: { ...sellerReplyArgs, requestId: v.string(), content: v.string() }, returns: v.id("assistantDispatches"),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== business._id || customer.deletedAt !== undefined) throw new ConvexError({ code: "NOT_FOUND" });
    const content = args.content.trim();
    if (!/^[a-f0-9-]{36}$/.test(args.requestId) || !content || content.length > 4096) throw new ConvexError({ code: "META_INVALID_REPLY" });
    const previous = await ctx.db.query("assistantDispatches").withIndex("by_business_meta_request", (builder) => builder.eq("businessId", business._id).eq("metaRequestKey", args.requestId)).unique();
    if (previous) {
      if (previous.customerId !== customer._id || previous.content !== content) throw new ConvexError({ code: "META_REQUEST_CONFLICT" });
      return previous._id;
    }
    const target = await sellerReplyTarget(ctx, business, customer);
    if (!target) throw new ConvexError({ code: "META_SERVICE_REPLY_UNAVAILABLE" });
    const now = Date.now();
    const burst = await ctx.db.query("assistantDispatches").withIndex("by_business_time", (builder) => builder.eq("businessId", business._id).gte("createdAt", now - 10_000)).take(20);
    const preceding = await ctx.db.query("assistantDispatches").withIndex("by_customer_kind", (builder) => builder.eq("customerId", customer._id).eq("kind", "seller_reply")).order("desc").first();
    if (burst.length === 20 || (preceding && (preceding.createdAt > now - 2000 || ["reserved", "submitting", "unknown"].includes(preceding.state)))) throw new ConvexError({ code: "META_REPLY_RATE_LIMIT" });
    const inbound = target.conversation.metaInboundId ? await ctx.db.get(target.conversation.metaInboundId) : null;
    if (!inbound || inbound.customerId !== customer._id || inbound.role !== "customer" || inbound.sessionId !== target.binding._id) throw new ConvexError({ code: "META_SERVICE_REPLY_UNAVAILABLE" });
    const dispatchId = await ctx.db.insert("assistantDispatches", { businessId: business._id, customerId: customer._id, interactionId: inbound._id, sessionId: target.binding._id, target: customer.phone, content, metaGeneration: target.binding.generation, metaRequestKey: args.requestId, metaCheckAt: now + metaDispatchDeadline, isGroup: false, kind: "seller_reply", state: "reserved", attempts: 0, createdAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.assistantReply.submit, { dispatchId });
    return dispatchId;
  },
});

function metaCanReply(session: Doc<"whatsappSessions">, interaction: Doc<"interactions">, conversation: Doc<"conversations"> | null, target: string, kind = "assistant_reply") {
  if (session.provider !== "meta") return true;
  return process.env.META_WHATSAPP_SEND_ENABLED === "true" && metaRecipient(target) !== null && !!conversation &&
    conversation.metaInboundGeneration === session.generation && (conversation.metaInboundAt ?? 0) > Date.now() - META_SERVICE_WINDOW_MS &&
    interaction.timestamp >= Math.floor(session.consentAt / 1000) * 1000 && (kind !== "assistant_reply" || (conversation.lastOwnerAt ?? 0) < interaction.timestamp);
}

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
    const existing = await ctx.db.query("assistantDispatches").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).take(20);
    if (existing.some((dispatch) => (dispatch.kind ?? "assistant_reply") === "assistant_reply")) return null;
    const [business, customer, session] = await Promise.all([
      ctx.db.get(interaction.businessId),
      ctx.db.get(interaction.customerId),
      interaction.sessionId ? ctx.db.get(interaction.sessionId) : null,
    ]);
    const conversation = interaction.conversationId ? await ctx.db.get(interaction.conversationId) : null;
    if (!canProcessInboxMessage(business, interaction) || !customer || customer.deletedAt !== undefined || customer.businessId !== business._id || !session || session.businessId !== business._id || session.state !== "connected" || !session.providerInstanceId) return null;
    const access = await billingAccess(ctx, business);
    if (!access.canUsePaidFeatures || !access.automation) return null;
    if (conversation && (conversation.businessId !== business._id || conversation.customerId !== customer._id)) return null;
    if (!metaCanReply(session, interaction, conversation, customer.phone)) return null;
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
  args: { conversationId: v.id("conversations"), interactionId: v.id("interactions"), threadId: v.string() },
  returns: v.object({ threadId: v.string(), attached: v.boolean() }),
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    const interaction = await ctx.db.get(args.interactionId);
    if (!conversation || !interaction || interaction.conversationId !== conversation._id || interaction.businessId !== conversation.businessId || !canProcessInboxMessage(await ctx.db.get(conversation.businessId), interaction)) return { threadId: args.threadId, attached: false };
    if (conversation.agentThreadId) return { threadId: conversation.agentThreadId, attached: conversation.agentThreadId === args.threadId };
    await ctx.db.patch(conversation._id, { agentThreadId: args.threadId.slice(0, 200) });
    return { threadId: args.threadId, attached: true };
  },
});

export const recentConversation = internalQuery({
  args: { interactionId: v.id("interactions") },
  returns: v.array(v.object({ role: v.union(v.literal("customer"), v.literal("owner"), v.literal("system")), content: v.string() })),
  handler: async (ctx, args) => {
    const current = await ctx.db.get(args.interactionId);
    if (!current) return [];
    const business = await ctx.db.get(current.businessId);
    if (!canProcessInboxMessage(business, current)) return [];
    const messages = await ctx.db.query("interactions").withIndex("by_customer", (builder) => builder.eq("customerId", current.customerId)).order("desc").take(12);
    return messages.filter((message) => message._id !== current._id && message.businessId === business._id && canProcessInboxMessage(business, message)).slice(0, 8).reverse().map((message) => ({ role: message.role, content: message.content.slice(0, 2_000) }));
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
    const existing = await ctx.db.query("assistantDispatches").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).take(20);
    if (existing.some((dispatch) => (dispatch.kind ?? "assistant_reply") === "assistant_reply")) return null;
    const customer = await ctx.db.get(interaction.customerId);
    const business = await ctx.db.get(interaction.businessId);
    const session = await ctx.db.get(interaction.sessionId);
    if (!canProcessInboxMessage(business, interaction) || !customer || customer.businessId !== interaction.businessId || !session || session.businessId !== business._id || session.state !== "connected" || !session.providerInstanceId || (business.killSwitch ?? true)) return null;
    if ((business.businessSystemPrompt?.trim().length ?? 0) < BUSINESS_SYSTEM_PROMPT_MIN_LENGTH) return null;
    const isGroup = interaction.isGroup ?? customer.isGroup ?? false;
    if (isGroup) {
      if (!(business.groupAutoReplyEnabled ?? false)) return null;
      const group = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", business._id).eq("groupJid", customer.phone)).unique();
      if (!group || !groupMayAutoReply(group, interaction)) return null;
    } else if (!(business.customerAutoReplyEnabled ?? false)) {
      return null;
    }
    let conversationId = interaction.conversationId ?? (await ctx.db.query("conversations").withIndex("by_customer", (builder) => builder.eq("customerId", interaction.customerId)).order("desc").first())?._id;
    if (!conversationId) {
      const identityKey = customer.identityKey ?? customer.phone;
      const linked = await ctx.db.query("conversations").withIndex("by_business_identity", (builder) => builder.eq("businessId", business._id).eq("identityKey", identityKey)).unique();
      conversationId = linked?._id ?? await ctx.db.insert("conversations", { businessId: business._id, customerId: customer._id, identityKey, revision: 1, lastEventAt: interaction.timestamp, lastInboundAt: interaction.timestamp, messageCount: 1 });
      await ctx.db.patch(interaction._id, { conversationId });
    }
    if (!conversationId || (session.provider === "meta" && !metaCanReply(session, interaction, await ctx.db.get(conversationId), customer.phone)) || !(await reserveAssistedConversation(ctx, { business, conversationId }))) return null;
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
      ...(session.provider === "meta" ? { metaGeneration: session.generation, metaCheckAt: now + metaDispatchDeadline } : {}),
      kind: "assistant_reply",
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
    await ctx.db.patch(dispatch._id, { state: "submitting", attempts: 1, updatedAt: Date.now(), ...(dispatch.metaGeneration !== undefined ? { metaCheckAt: Date.now() + metaDispatchDeadline } : {}) });
    return true;
  },
});

export const cancelBeforeSubmit = internalMutation({
  args: { dispatchId: v.id("assistantDispatches"), errorCode: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);
    if (!dispatch || dispatch.state !== "submitting") return null;
    const now = Date.now();
    await ctx.db.patch(dispatch._id, { state: "cancelled", errorCode: args.errorCode, updatedAt: now, metaCheckAt: undefined });
    if (dispatch.ownerRescueId) {
      const rescue = await ctx.db.get(dispatch.ownerRescueId);
      if (rescue?.state === "sending") await ctx.db.patch(rescue._id, { state: "open", deliveryError: "Pipelixr did not send this answer because authorization changed. Reply directly in WhatsApp.", updatedAt: now });
    }
    return null;
  },
});

export const finish = internalMutation({
  args: { dispatchId: v.id("assistantDispatches"), state: v.union(v.literal("accepted"), v.literal("failed"), v.literal("unknown"), v.literal("cancelled")), providerMessageId: v.optional(v.string()), errorCode: v.optional(v.string()), metaReconciled: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);
    if (!dispatch || (!["reserved", "submitting"].includes(dispatch.state) && !(args.metaReconciled && dispatch.metaGeneration !== undefined && dispatch.state === "unknown"))) return null;
    await ctx.db.patch(dispatch._id, { state: args.state, providerMessageId: args.providerMessageId, errorCode: args.errorCode, updatedAt: Date.now(), metaCheckAt: undefined });
    if (args.state === "accepted") await recordDuplicateDispatch(ctx, dispatch._id, args.providerMessageId);
    if (dispatch.ownerRescueId) {
      const rescue = await ctx.db.get(dispatch.ownerRescueId);
      if (rescue?.state === "sending" || (args.metaReconciled && rescue?.state === "delivery_unknown")) {
        const now = Date.now();
        if (args.state === "accepted") {
          await ctx.db.patch(rescue._id, { state: "answered", answeredAt: now, deliveryError: undefined, updatedAt: now });
          if (rescue.exceptionId) {
            const exception = await ctx.db.get(rescue.exceptionId);
            if (exception?.businessId === rescue.businessId) await ctx.db.patch(exception._id, { state: "open", approvedResolution: rescue.ownerAnswer, updatedAt: now });
          }
        } else if (args.state === "unknown") {
          await ctx.db.patch(rescue._id, { state: "delivery_unknown", deliveryError: "WhatsApp did not confirm whether this answer was delivered. Check the customer chat before sending anything again.", updatedAt: now });
        } else {
          await ctx.db.patch(rescue._id, { state: "open", deliveryError: "Pipelixr could not deliver this answer. Check the WhatsApp connection and try again.", updatedAt: now });
        }
      }
    }
    if (args.state === "accepted") {
      const now = Date.now();
      const sellerReply = dispatch.kind === "seller_reply";
      const inbound = await ctx.db.get(dispatch.interactionId);
      const allowAnalysis = inbound && canProcessInboxMessage(await ctx.db.get(dispatch.businessId), inbound);
      const customer = await ctx.db.get(dispatch.customerId);
      if (!customer || customer.deletedAt !== undefined) return null;
      const session = dispatch.metaGeneration === undefined ? null : await ctx.db.get(dispatch.sessionId);
      const providerEventKey = session?.providerInstanceId && args.providerMessageId ? `meta:${session.providerInstanceId}:${args.providerMessageId}` : undefined;
      const mirror = providerEventKey ? await ctx.db.query("interactions").withIndex("by_business_event", (builder) => builder.eq("businessId", dispatch.businessId).eq("providerEventKey", providerEventKey)).unique() : null;
      if (mirror) {
        if (mirror.customerId === dispatch.customerId && mirror.role === "owner") await ctx.db.patch(mirror._id, { assistantDispatchId: dispatch._id });
        return null;
      }
      const interactionId = await ctx.db.insert("interactions", { businessId: dispatch.businessId, customerId: dispatch.customerId, ...(inbound?.conversationId ? { conversationId: inbound.conversationId } : {}), sessionId: dispatch.sessionId, role: "owner", content: dispatch.content, timestamp: now, receivedAt: now, aiProcessingEpoch: inbound?.aiProcessingEpoch ?? null, isGroup: dispatch.isGroup, messageType: "text", aiProcessedAt: now, assistantDispatchId: dispatch._id, ...(providerEventKey ? { providerEventKey, whatsappMessageId: args.providerMessageId } : {}), expiresAt: now + foundationPolicy().messageRetentionDays * 86_400_000 });
      if (inbound?.conversationId) await recordResponseTime(ctx, { businessId: dispatch.businessId, conversationId: inbound.conversationId, responseInteractionId: interactionId, responseAt: now, source: sellerReply ? "owner" : "assistant" });
      if (customer) await ctx.db.patch(customer._id, { lastInteraction: Math.max(customer.lastInteraction, now), lastOutboundAt: now });
      if (inbound?.conversationId) {
        const conversation = await ctx.db.get(inbound.conversationId);
        if (conversation) await ctx.db.patch(conversation._id, { revision: conversation.revision + 1, lastEventAt: Math.max(conversation.lastEventAt, now), lastOwnerAt: Math.max(conversation.lastOwnerAt ?? 0, now), messageCount: conversation.messageCount + 1 });
        if (allowAnalysis && dispatch.qualificationQuestionField) await ctx.scheduler.runAfter(0, internal.leadQualification.recordQuestionAsked, { conversationId: inbound.conversationId, interactionId: inbound._id, field: dispatch.qualificationQuestionField, askedAt: now });
      }
      const missed = await ctx.db.query("missedRevenueOpportunities").withIndex("by_interaction", (builder) => builder.eq("interactionId", dispatch.interactionId)).unique();
      if (missed && missed.state !== "answered") {
        if (missed.scheduledId) { const scheduled = await ctx.db.system.get(missed.scheduledId); if (scheduled?.state.kind === "pending") await ctx.scheduler.cancel(missed.scheduledId); }
        await ctx.db.patch(missed._id, { state: "answered", answeredAt: now });
      }
      const opportunity = await ctx.db.query("communityOpportunities").withIndex("by_interaction", (builder) => builder.eq("interactionId", dispatch.interactionId)).unique();
      if (opportunity && opportunity.state === "open") await ctx.db.patch(opportunity._id, { state: "in_progress", updatedAt: now });
      if (sellerReply) return null;
      if (allowAnalysis && !dispatch.isGroup) await ctx.scheduler.runAfter(0, internal.commerceIntelligence.captureFromInteraction, { interactionId });
      await ctx.db.insert("aiActivityLog", { businessId: dispatch.businessId, type: "smart_reply", interactionId, customerId: dispatch.customerId, summary: dispatch.kind === "owner_rescue" ? "Sent the business owner's approved answer to a customer" : dispatch.isGroup ? "Replied in an authorized WhatsApp group" : "Replied to a customer on WhatsApp", model: process.env.GROQ_LLM_MODEL?.trim() || "configured-model", timestamp: now });
    }
    return null;
  },
});

export const applyMetaStatus = internalMutation({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number(), messageId: v.string(), status: v.union(v.literal("sent"), v.literal("delivered"), v.literal("read"), v.literal("failed")), at: v.number(), dispatchRef: v.string(), errorCode: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (session?.provider !== "meta" || session.generation !== args.generation || session.state !== "connected") return null;
    const callbackId = ctx.db.normalizeId("assistantDispatches", args.dispatchRef);
    const dispatch = callbackId ? await ctx.db.get(callbackId) : await ctx.db.query("assistantDispatches").withIndex("by_business_provider_message", (builder) => builder.eq("businessId", session.businessId).eq("providerMessageId", args.messageId)).first();
    if (!dispatch || dispatch.businessId !== session.businessId || dispatch.sessionId !== session._id || dispatch.metaGeneration !== session.generation || !["submitting", "unknown", "accepted"].includes(dispatch.state) || (dispatch.providerMessageId && dispatch.providerMessageId !== args.messageId)) return null;
    if (args.at < Math.floor(dispatch.createdAt / 1000) * 1000) return null;
    const rank = { sent: 1, failed: 2, delivered: 3, read: 4 };
    if (dispatch.metaDeliveryState && rank[dispatch.metaDeliveryState] >= rank[args.status]) return null;
    const errorCode = args.status === "failed" ? `META_DELIVERY_FAILED${args.errorCode !== undefined ? `_${args.errorCode}` : ""}` : undefined;
    if (dispatch.state !== "accepted") {
      await ctx.runMutation(internal.assistantReply.finish, { dispatchId: dispatch._id, state: args.status === "failed" ? "failed" : "accepted", providerMessageId: args.messageId, errorCode, metaReconciled: true });
    }
    await ctx.db.patch(dispatch._id, { metaDeliveryState: args.status, metaDeliveryAt: args.at, errorCode });
    if (dispatch.state === "accepted" && dispatch.ownerRescueId) {
      const rescue = await ctx.db.get(dispatch.ownerRescueId);
      if (args.status === "failed" && rescue?.state === "answered") await ctx.db.patch(rescue._id, { state: "delivery_unknown", deliveryError: "Meta reported a delivery failure. Check the chat in WhatsApp before replying again.", updatedAt: Date.now() });
      else if ((args.status === "delivered" || args.status === "read") && rescue?.state === "delivery_unknown") await ctx.db.patch(rescue._id, { state: "answered", deliveryError: undefined, updatedAt: Date.now() });
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

async function generateAgentReply(ctx: ActionCtx, args: {
  systemPrompt: string;
  customerName: string;
  inboundContent: string;
  interactionId: Id<"interactions">;
  history: Array<{ role: "customer" | "owner" | "system"; content: string }>;
  businessId: Id<"businesses">;
  customerId: Id<"customers">;
  conversationId: Id<"conversations"> | null;
  agentThreadId: string | null;
}, authorize: () => Promise<boolean>): Promise<string> {
  const model = process.env.CONVEX_AI_GATEWAY_MODEL?.trim();
  if (!model) throw new Error("AI_GATEWAY_NOT_CONFIGURED");
  const agent = new Agent(components.agent, {
    name: "pipelixr-whatsapp-assistant",
    languageModel: wrapLanguageModel({
      model: convexGateway(model, { zdr: true }),
      middleware: {
        specificationVersion: "v4",
        wrapGenerate: async ({ doGenerate }) => {
          if (!(await authorize())) throw new Error("AI_ASSISTANT_PAUSED");
          return doGenerate();
        },
      },
    }),
  });
  const userId = `business:${args.businessId}:customer:${args.customerId}`;
  let threadId = args.agentThreadId;
  if (!threadId && args.conversationId) {
    const created = await agent.createThread(ctx, { userId, title: `${args.customerName} WhatsApp conversation` });
    const attached = await ctx.runMutation(internal.assistantReply.attachAgentThread, { conversationId: args.conversationId, interactionId: args.interactionId, threadId: created.threadId });
    if (!attached.attached) {
      await agent.deleteThreadAsync(ctx, { threadId: created.threadId });
      if (attached.threadId === created.threadId) throw new Error("AI_ASSISTANT_PAUSED");
    }
    threadId = attached.threadId;
  }
  if (!threadId) throw new Error("AI_THREAD_NOT_AVAILABLE");
  if (!(await authorize())) throw new Error("AI_ASSISTANT_PAUSED");
  const result = await agent.generateText(ctx, { threadId, userId }, {
    system: args.systemPrompt,
    messages: [
      ...args.history.map((message) => ({ role: message.role === "owner" ? "assistant" as const : message.role === "customer" ? "user" as const : "system" as const, content: message.content })),
      { role: "user", content: `${args.customerName} just sent: ${args.inboundContent}\nReturn only the WhatsApp reply.` },
    ],
    temperature: 0.35,
    maxOutputTokens: 260,
    maxRetries: 0,
  }, {
    contextOptions: { recentMessages: 0 },
    storageOptions: { saveMessages: "none" },
  });
  const reply = normalizeAssistantReply(result.text);
  if (reply.length < 2 || reply.length > 1_000) throw new Error("AI_GENERATION_FAILED");
  return reply;
}

export const ownerRescueCandidate = internalQuery({
  args: { rescueId: v.id("ownerRescueRequests") },
  returns: v.union(v.null(), v.object({
    rescueId: v.id("ownerRescueRequests"), businessId: v.id("businesses"), customerId: v.id("customers"), conversationId: v.id("conversations"), interactionId: v.id("interactions"),
    customerName: v.string(), inboundContent: v.string(), contextSummary: v.string(), ownerAnswer: v.string(), systemPrompt: v.string(), agentThreadId: v.union(v.string(), v.null()),
  })),
  handler: async (ctx, args) => {
    const rescue = await ctx.db.get(args.rescueId);
    if (!rescue || rescue.state !== "sending" || !rescue.ownerAnswer?.trim() || rescue.expiresAt <= Date.now()) return null;
    const [business, customer, conversation, interaction] = await Promise.all([ctx.db.get(rescue.businessId), ctx.db.get(rescue.customerId), ctx.db.get(rescue.conversationId), ctx.db.get(rescue.interactionId)]);
    if (!interaction || !canProcessInboxMessage(business, interaction) || (business.killSwitch ?? true) || !(business.customerAutoReplyEnabled ?? false)) return null;
    const access = await billingAccess(ctx, business);
    if (!access.canUsePaidFeatures || !access.automation) return null;
    const systemPrompt = business.businessSystemPrompt?.trim() ?? "";
    if (systemPrompt.length < BUSINESS_SYSTEM_PROMPT_MIN_LENGTH || !customer || customer.businessId !== business._id || customer.isGroup || customer.deletedAt !== undefined) return null;
    if (!conversation || conversation.businessId !== business._id || conversation.customerId !== customer._id || interaction.businessId !== business._id || interaction.customerId !== customer._id || interaction.conversationId !== conversation._id || interaction.role !== "customer") return null;
    return { rescueId: rescue._id, businessId: business._id, customerId: customer._id, conversationId: conversation._id, interactionId: interaction._id, customerName: customer.name ?? "customer", inboundContent: interaction.content, contextSummary: rescue.contextSummary, ownerAnswer: rescue.ownerAnswer, systemPrompt, agentThreadId: conversation.agentThreadId ?? null };
  },
});

export const releaseOwnerRescue = internalMutation({
  args: { rescueId: v.id("ownerRescueRequests"), message: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rescue = await ctx.db.get(args.rescueId);
    if (rescue?.state === "sending") await ctx.db.patch(rescue._id, { state: "open", deliveryError: args.message.slice(0, 500), updatedAt: Date.now() });
    return null;
  },
});

export const reserveOwnerRescue = internalMutation({
  args: { rescueId: v.id("ownerRescueRequests"), content: v.string() },
  returns: v.union(v.null(), v.id("assistantDispatches")),
  handler: async (ctx, args) => {
    const content = normalizeAssistantReply(args.content);
    if (content.length < 2 || content.length > 1_000) return null;
    const rescue = await ctx.db.get(args.rescueId);
    if (!rescue || rescue.state !== "sending" || !rescue.ownerAnswer?.trim() || rescue.expiresAt <= Date.now()) return null;
    const [business, customer, interaction] = await Promise.all([ctx.db.get(rescue.businessId), ctx.db.get(rescue.customerId), ctx.db.get(rescue.interactionId)]);
    if (!interaction || !canProcessInboxMessage(business, interaction) || (business.killSwitch ?? true) || !(business.customerAutoReplyEnabled ?? false) || (business.businessSystemPrompt?.trim().length ?? 0) < BUSINESS_SYSTEM_PROMPT_MIN_LENGTH) return null;
    const access = await billingAccess(ctx, business);
    if (!access.canUsePaidFeatures || !access.automation) return null;
    if (!customer || customer.businessId !== business._id || customer.isGroup || customer.deletedAt !== undefined || interaction.businessId !== business._id || interaction.customerId !== customer._id || interaction.role !== "customer" || !interaction.sessionId) return null;
    const session = await ctx.db.get(interaction.sessionId);
    if (!session || session.businessId !== business._id || session.state !== "connected" || !session.providerInstanceId) return null;
    let conversationId = interaction.conversationId ?? (await ctx.db.query("conversations").withIndex("by_customer", (builder) => builder.eq("customerId", interaction.customerId)).order("desc").first())?._id;
    if (!conversationId) {
      const identityKey = customer.identityKey ?? customer.phone;
      const linked = await ctx.db.query("conversations").withIndex("by_business_identity", (builder) => builder.eq("businessId", business._id).eq("identityKey", identityKey)).unique();
      conversationId = linked?._id ?? await ctx.db.insert("conversations", { businessId: business._id, customerId: customer._id, identityKey, revision: 1, lastEventAt: interaction.timestamp, lastInboundAt: interaction.timestamp, messageCount: 1 });
      await ctx.db.patch(interaction._id, { conversationId });
    }
    if (!conversationId || (session.provider === "meta" && !metaCanReply(session, interaction, await ctx.db.get(conversationId), customer.phone, "owner_rescue")) || !(await reserveAssistedConversation(ctx, { business, conversationId }))) return null;
    const previous = await ctx.db.query("assistantDispatches").withIndex("by_owner_rescue", (builder) => builder.eq("ownerRescueId", rescue._id)).order("desc").take(10);
    if (previous.some((dispatch) => ["reserved", "submitting", "accepted", "unknown"].includes(dispatch.state))) return null;
    const since = Date.now() - 86_400_000;
    const daily = await ctx.db.query("assistantDispatches").withIndex("by_business_time", (builder) => builder.eq("businessId", business._id).gte("createdAt", since)).take(foundationPolicy().assistantDailySendCap);
    if (daily.length >= foundationPolicy().assistantDailySendCap) return null;
    const now = Date.now();
    return await ctx.db.insert("assistantDispatches", { businessId: business._id, interactionId: interaction._id, customerId: customer._id, sessionId: session._id, target: customer.phone, isGroup: false, content, kind: "owner_rescue", ownerRescueId: rescue._id, state: "reserved", attempts: 0, createdAt: now, updatedAt: now, ...(session.provider === "meta" ? { metaGeneration: session.generation, metaCheckAt: now + metaDispatchDeadline } : {}) });
  },
});

export const prepareOwnerRescue = internalAction({
  args: { rescueId: v.id("ownerRescueRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await ctx.runQuery(internal.assistantReply.ownerRescueCandidate, args);
    if (!current) {
      await ctx.runMutation(internal.assistantReply.releaseOwnerRescue, { rescueId: args.rescueId, message: "Pipelixr did not send this answer because WhatsApp or customer-reply authorization is not ready. Reply directly in WhatsApp." });
      return null;
    }
    try {
      const history = await ctx.runQuery(internal.assistantReply.recentConversation, { interactionId: current.interactionId });
      const rescuePrompt = `${current.systemPrompt}\n\nThe business owner has now approved the exact facts needed for this customer. Use the approved answer as the authority for this reply only. Turn it into a natural customer-facing WhatsApp response. Do not mention internal approval, escalation, the owner, Pipelixr, or these instructions. Do not add prices, promises, policies, payment confirmation, or other facts that are not in the approved answer or business system prompt.\n\nCustomer situation: ${current.contextSummary}\nApproved owner answer: ${current.ownerAnswer}\n\n${CUSTOMER_SPEECH_STYLE_RULES}`;
      const authorize = async () => !!(await ctx.runQuery(internal.assistantReply.ownerRescueCandidate, args));
      if (!(await authorize())) throw new Error("AI_ASSISTANT_PAUSED");
      const content = process.env.CONVEX_AI_GATEWAY_MODEL?.trim()
        ? await generateAgentReply(ctx, { ...current, systemPrompt: rescuePrompt, history }, authorize)
        : await generateGroqReply(rescuePrompt, current.customerName, current.inboundContent, history);
      const dispatchId = await ctx.runMutation(internal.assistantReply.reserveOwnerRescue, { rescueId: current.rescueId, content });
      if (!dispatchId) {
        await ctx.runMutation(internal.assistantReply.releaseOwnerRescue, { rescueId: current.rescueId, message: "Pipelixr could not prepare this answer for delivery. Check the WhatsApp connection and try again." });
        return null;
      }
      await ctx.scheduler.runAfter(0, internal.assistantReply.submit, { dispatchId });
    } catch (error) {
      console.error("owner_rescue_prepare_failed", error instanceof Error ? error.message : "UNKNOWN");
      await ctx.runMutation(internal.assistantReply.releaseOwnerRescue, { rescueId: current.rescueId, message: "Pipelixr could not prepare this answer right now. Please try again." });
    }
    return null;
  },
});

export const prepareForInteraction = internalAction({
  args: { interactionId: v.id("interactions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await ctx.runQuery(internal.assistantReply.candidateForInteraction, args);
    if (!current) return null;
    try {
      const authorize = async () => !!(await ctx.runQuery(internal.assistantReply.candidateForInteraction, args));
      const qualification = current.isGroup ? null : await ctx.runAction(internal.leadQualification.analyzeInteraction, { interactionId: current.interactionId });
      if (!(await authorize())) return null;
      const gate = await ctx.runQuery(internal.commerceIntelligence.gateForAssistant, { interactionId: current.interactionId });
      if (gate) {
        const dispatchId = await ctx.runMutation(internal.assistantReply.reserve, { interactionId: current.interactionId, content: gate.holdingReply });
        if (dispatchId) await ctx.scheduler.runAfter(0, internal.assistantReply.submit, { dispatchId });
        return null;
      }
      const history = await ctx.runQuery(internal.assistantReply.recentConversation, args);
      const context = current.conversationId ? await ctx.runQuery(internal.commerceIntelligence.assistantContext, { businessId: current.businessId, customerId: current.customerId, conversationId: current.conversationId, now: Date.now() }) : { knowledge: [], memories: [], commitments: [], exceptions: [], negotiation: null, payment: null };
      if (!(await authorize())) return null;
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
        content = await generateAgentReply(ctx, { ...current, systemPrompt: groundedSystemPrompt, history }, authorize);
      } else {
        content = await generateGroqReply(groundedSystemPrompt, current.customerName, current.inboundContent, history);
      }
      if (!(await authorize())) return null;
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
      if (record.meta) {
        if (record.automated) await new Promise((resolve) => setTimeout(resolve, 2500));
        const current = await ctx.runQuery(internal.assistantReply.dispatchForSubmit, args);
        if (!current?.meta) {
          await ctx.runMutation(internal.assistantReply.cancelBeforeSubmit, { ...args, errorCode: "META_AUTHORIZATION_CHANGED" });
          return null;
        }
        const messageId = await sendMetaText({ token, phoneId: current.providerInstanceId, target: current.target, content: current.content, dispatchId: args.dispatchId });
        await ctx.runMutation(internal.assistantReply.finish, { ...args, state: "accepted", providerMessageId: messageId });
        return null;
      }
      if (!(await ctx.runQuery(internal.assistantReply.dispatchForSubmit, args))) {
        await ctx.runMutation(internal.assistantReply.cancelBeforeSubmit, { dispatchId: args.dispatchId, errorCode: "AUTHORIZATION_REVOKED_BEFORE_TYPING" });
        return null;
      }
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
      if (!(await ctx.runQuery(internal.assistantReply.dispatchForSubmit, args))) {
        await ctx.runMutation(internal.assistantReply.cancelBeforeSubmit, { dispatchId: args.dispatchId, errorCode: "AUTHORIZATION_REVOKED_BEFORE_SEND" });
        return null;
      }
      const result = await sendAuthorizedAssistantText({ token: currentToken, instanceId: revalidated.providerInstanceId, target: revalidated.target, content: revalidated.content, interactionId: revalidated.interactionId });
      const provider = providerSendResult(result);
      await ctx.runMutation(internal.assistantReply.finish, { dispatchId: args.dispatchId, state: "accepted", ...(provider.messageId ? { providerMessageId: provider.messageId } : {}) });
    } catch (error) {
      const code = error instanceof Error ? error.message : "SEND_FAILED";
      const state = (error instanceof MetaError && error.rejected) || ["PROVIDER_NOT_CONFIGURED", "PROVIDER_DISABLED", "INSECURE_PROVIDER_URL", "INVALID_PROVIDER_URL", "INVALID_PROVIDER_AUTH_MODE", "PROVIDER_AUTH_FAILED"].includes(code) ? "failed" as const : "unknown" as const;
      await ctx.runMutation(internal.assistantReply.finish, { dispatchId: args.dispatchId, state, errorCode: code });
      if (record.binding && code === "META_AUTH_EXPIRED") await ctx.runMutation(internal.metaConnections.healthResult, { ...record.binding, code, stopSending: true });
    }
    return null;
  },
});

export const dispatchForSubmit = internalQuery({
  args: { dispatchId: v.id("assistantDispatches") },
  returns: v.union(v.null(), v.object({ businessId: v.id("businesses"), interactionId: v.id("interactions"), target: v.string(), content: v.string(), tokenCiphertext: v.string(), providerInstanceId: v.string(), meta: v.boolean(), automated: v.boolean(), binding: v.optional(v.object({ sessionId: v.id("whatsappSessions"), generation: v.number() })) })),
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);
    if (!dispatch || dispatch.state !== "submitting") return null;
    const [business, session, interaction, customer] = await Promise.all([
      ctx.db.get(dispatch.businessId),
      ctx.db.get(dispatch.sessionId),
      ctx.db.get(dispatch.interactionId),
      ctx.db.get(dispatch.customerId),
    ]);
    if (dispatch.kind === "seller_reply") {
      if (business?.foundationVersion !== 1 || !session || !interaction || interaction.businessId !== business._id || !customer || customer.phone !== dispatch.target || !session.providerInstanceId || dispatch.metaGeneration !== session.generation || !await sellerReplyTarget(ctx, business, customer, session)) return null;
      return { businessId: business._id, interactionId: dispatch.interactionId, target: dispatch.target, content: dispatch.content, tokenCiphertext: session.tokenCiphertext, providerInstanceId: session.providerInstanceId, meta: true, automated: false, binding: { sessionId: session._id, generation: session.generation } };
    }
    if (!interaction || !canProcessInboxMessage(business, interaction) || !session || session.businessId !== business._id || session.state !== "connected" || !session.providerInstanceId || (business.killSwitch ?? true)) return null;
    const access = await billingAccess(ctx, business);
    if (!access.canUsePaidFeatures || !access.automation) return null;
    if (!interaction || interaction.businessId !== business._id || interaction.customerId !== dispatch.customerId || interaction.sessionId !== session._id || interaction.role !== "customer") return null;
    const kind = dispatch.kind ?? "assistant_reply";
    if (kind === "assistant_reply" && interaction.manualReviewRequired) return null;
    if (kind === "assistant_reply" && interaction.messageType === "image" && (interaction.imageAnalysisState !== "completed" || !interaction.imageAnalysis?.trim())) return null;
    if (!customer || customer.businessId !== business._id || customer.phone !== dispatch.target || !await canSendServiceMessage(ctx, customer) || (business.businessSystemPrompt?.trim().length ?? 0) < BUSINESS_SYSTEM_PROMPT_MIN_LENGTH) return null;
    const meta = session.provider === "meta";
    if (meta && (dispatch.metaGeneration !== session.generation || !metaCanReply(session, interaction, interaction.conversationId ? await ctx.db.get(interaction.conversationId) : null, dispatch.target, kind))) return null;
    if (kind === "owner_rescue") {
      if (!dispatch.ownerRescueId || !(business.customerAutoReplyEnabled ?? false)) return null;
      const rescue = await ctx.db.get(dispatch.ownerRescueId);
      if (!rescue || rescue.state !== "sending" || rescue.businessId !== business._id || rescue.customerId !== customer._id || rescue.interactionId !== interaction._id || !rescue.ownerAnswer?.trim() || rescue.expiresAt <= Date.now()) return null;
      return { businessId: business._id, interactionId: dispatch.interactionId, target: dispatch.target, content: dispatch.content, tokenCiphertext: session.tokenCiphertext, providerInstanceId: session.providerInstanceId, meta, automated: true, ...(meta ? { binding: { sessionId: session._id, generation: session.generation } } : {}) };
    }
    const isGroup = interaction.isGroup ?? customer.isGroup ?? false;
    if (isGroup !== dispatch.isGroup) return null;
    if (isGroup) {
      if (!(business.groupAutoReplyEnabled ?? false)) return null;
      const group = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", business._id).eq("groupJid", customer.phone)).unique();
      if (!group || !groupMayAutoReply(group, interaction)) return null;
    } else if (!(business.customerAutoReplyEnabled ?? false)) {
      return null;
    }
    return { businessId: business._id, interactionId: dispatch.interactionId, target: dispatch.target, content: dispatch.content, tokenCiphertext: session.tokenCiphertext, providerInstanceId: session.providerInstanceId, meta, automated: true, ...(meta ? { binding: { sessionId: session._id, generation: session.generation } } : {}) };
  },
});
