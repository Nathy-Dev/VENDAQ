import { ConvexError, v, type Infer } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { eventDocument, normalizedEvent } from "./lib/validators";
import { foundationPolicy, logEvent } from "./lib/policy";
import { keywordClassifier } from "./lib/classifier";
import { journeyAfterInbound, type JourneyStage } from "./lib/journey";
import { createStalledInquiryTask } from "./sellerActions";

export const enqueue = internalMutation({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number(), tokenHash: v.string(), eventKey: v.string(), correlationId: v.string(), payload: normalizedEvent, quarantineCode: v.optional(v.string()) },
  returns: v.object({ eventId: v.id("inboundEvents"), duplicate: v.boolean(), correlationId: v.string() }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.state === "revoked" || session.generation !== args.generation || session.tokenHash !== args.tokenHash) throw new ConvexError({ code: "INVALID_WEBHOOK_AUTH" });
    const business = await ctx.db.get(session.businessId);
    if (!business || business.foundationVersion !== 1) throw new ConvexError({ code: "INVALID_WEBHOOK_AUTH" });
    const eventKey = `${session.generation}:${args.eventKey}`;
    const existing = await ctx.db.query("inboundEvents").withIndex("by_session_key", (builder) => builder.eq("sessionId", session._id).eq("eventKey", eventKey)).unique();
    if (existing) return { eventId: existing._id, duplicate: true, correlationId: existing.correlationId };
    const now = Date.now();
    const identityKey = args.payload.kind === "message" || args.payload.kind === "receipt" ? args.payload.identityKey : undefined;
    const suppression = identityKey ? await ctx.db.query("privacySuppressions").withIndex("by_business_identity", (builder) => builder.eq("businessId", session.businessId).eq("identityKey", identityKey)).unique() : null;
    // Never persist a new content copy after this contact requested deletion.
    const payload = suppression ? { kind: "ignored" as const, reason: "CONTACT_DELETED" } : args.payload;
    const eventId = await ctx.db.insert("inboundEvents", { businessId: session.businessId, sessionId: session._id, generation: session.generation, eventKey, correlationId: args.correlationId, payload, ...(identityKey ? { identityKey } : {}), state: "pending", attempts: 0, receivedAt: now, dueAt: now, expiresAt: now + foundationPolicy().eventRetentionDays * 86400000 });
    if (args.quarantineCode) {
      // A permanent contract mismatch is visible but stores no raw personal data.
      await ctx.db.patch(eventId, { state: "dead_letter", payload: undefined, errorCode: args.quarantineCode });
    } else {
      const scheduledId = await ctx.scheduler.runAfter(0, internal.ingestion.runEvent, { eventId });
      await ctx.db.patch(eventId, { scheduledId });
    }
    logEvent("webhook_committed", { correlationId: args.correlationId, businessId: session.businessId, eventId });
    return { eventId, duplicate: false, correlationId: args.correlationId };
  },
});

export const claimEvent = internalMutation({
  args: { eventId: v.id("inboundEvents") }, returns: v.union(v.null(), eventDocument),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.state !== "pending" || event.dueAt > Date.now()) return null;
    if (!event.payload || event.expiresAt <= Date.now() || event.attempts >= (event.retryLimit ?? foundationPolicy().retryAttempts)) {
      await ctx.db.patch(event._id, { state: "dead_letter", errorCode: "EVENT_EXPIRED_OR_EXHAUSTED", payload: undefined });
      return null;
    }
    await ctx.db.patch(event._id, { state: "processing", attempts: event.attempts + 1, dueAt: Date.now() + foundationPolicy().leaseMs });
    return await ctx.db.get(event._id);
  },
});

export const applyEvent = internalMutation({
  args: { eventId: v.id("inboundEvents"), attempt: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.state !== "processing" || event.attempts !== args.attempt || event.dueAt < Date.now()) return null;
    const session = await ctx.db.get(event.sessionId);
    const business = await ctx.db.get(event.businessId);
    const payload = event.payload;
    if (!session || !business || business.foundationVersion !== 1 || session.businessId !== business._id || session.state === "revoked" || session.generation !== event.generation || !payload || event.expiresAt <= Date.now()) {
      await ctx.db.patch(event._id, { state: "ignored", errorCode: "STALE_OR_REVOKED", payload: undefined, completedAt: Date.now() });
      return null;
    }
    if (payload.kind === "message") {
      const suppression = await ctx.db.query("privacySuppressions").withIndex("by_business_identity", (builder) => builder.eq("businessId", business._id).eq("identityKey", payload.identityKey)).unique();
      // Reject old replay after both inbox and conversation retention expire.
      const tooOld = payload.eventAt + (business.messageRetentionDays ?? foundationPolicy().messageRetentionDays) * 86400000 <= Date.now();
      if (!payload.identityKey || suppression || payload.eventAt < session.consentAt || tooOld) {
        await ctx.db.patch(event._id, { state: "ignored", errorCode: suppression ? "CONTACT_DELETED" : "BEFORE_CONSENT", payload: undefined, completedAt: Date.now() });
        return null;
      }
      const messageKey = `${session._id}:${event.eventKey}`;
      const existingMessage = await ctx.db.query("interactions").withIndex("by_business_event", (builder) => builder.eq("businessId", business._id).eq("providerEventKey", messageKey)).unique();
      if (!existingMessage) {
        let customer = await ctx.db.query("customers").withIndex("by_business_identity", (builder) => builder.eq("businessId", business._id).eq("identityKey", payload.identityKey)).unique();
        if (!customer) {
          const customerId = await ctx.db.insert("customers", { businessId: business._id, phone: payload.chat, ...(payload.name && !payload.fromMe ? { name: payload.name } : {}), identityKey: payload.identityKey, totalValue: 0, lastInteraction: payload.eventAt, ...(payload.fromMe ? { lastOutboundAt: payload.eventAt } : { firstInboundAt: payload.eventAt, lastInboundAt: payload.eventAt }), leadSource: payload.fromMe ? "imported" : "dm", funnelStage: payload.fromMe ? "viewer" : "engaged", tags: ["captured"] });
          customer = await ctx.db.get(customerId);
        }
        if (!customer || customer.deletedAt !== undefined) throw new Error("INVALID_CUSTOMER_STATE");
        await ctx.db.patch(customer._id, { expiresAt: Math.max(customer.lastInteraction, payload.eventAt) + (business.messageRetentionDays ?? foundationPolicy().messageRetentionDays) * 86400000 });
        await ctx.db.patch(customer._id, { lastInteraction: Math.max(customer.lastInteraction, payload.eventAt), ...(payload.fromMe ? { lastOutboundAt: Math.max(customer.lastOutboundAt ?? 0, payload.eventAt) } : { firstInboundAt: customer.firstInboundAt === undefined ? payload.eventAt : Math.min(customer.firstInboundAt, payload.eventAt), lastInboundAt: Math.max(customer.lastInboundAt ?? 0, payload.eventAt), leadSource: "dm" }), ...(!payload.fromMe && payload.name && !customer.name ? { name: payload.name } : {}) });
        let conversation = await ctx.db.query("conversations").withIndex("by_business_identity", (builder) => builder.eq("businessId", business._id).eq("identityKey", payload.identityKey)).unique();
        if (!conversation) {
          const conversationId = await ctx.db.insert("conversations", { businessId: business._id, customerId: customer._id, identityKey: payload.identityKey, revision: 0, lastEventAt: payload.eventAt, messageCount: 0 });
          conversation = await ctx.db.get(conversationId);
        }
        if (!conversation || conversation.customerId !== customer._id) throw new Error("INVALID_CONVERSATION_STATE");
        const lastOwnerAt = Math.max(conversation.lastOwnerAt ?? 0, payload.fromMe ? payload.eventAt : 0);
        await ctx.db.patch(conversation._id, { revision: conversation.revision + 1, lastEventAt: Math.max(conversation.lastEventAt, payload.eventAt), messageCount: conversation.messageCount + 1, ...(payload.fromMe ? { lastOwnerAt } : { lastInboundAt: Math.max(conversation.lastInboundAt ?? 0, payload.eventAt) }) });
        // Predictions are immutable evidence on customer messages. Owner messages
        // are response evidence only and never enter classifier evaluation.
        const classification = payload.fromMe ? null : keywordClassifier.classify({ text: payload.text, mediaType: payload.mediaType, manualReview: payload.manualReview });
        if (classification) {
          const currentStage = (customer.funnelStage ?? "viewer") as JourneyStage;
          const nextStage = journeyAfterInbound(currentStage, classification.label);
          if (nextStage !== currentStage) await ctx.db.patch(customer._id, { funnelStage: nextStage });
        }
        const expiresAt = payload.eventAt + (business.messageRetentionDays ?? foundationPolicy().messageRetentionDays) * 86400000;
        const interactionId = await ctx.db.insert("interactions", { businessId: business._id, customerId: customer._id, conversationId: conversation._id, sessionId: session._id, role: payload.fromMe ? "owner" : "customer", content: payload.text, timestamp: payload.eventAt, receivedAt: event.receivedAt, providerEventKey: messageKey, whatsappMessageId: payload.messageId, ...(payload.mediaType !== "unsupported" ? { messageType: payload.mediaType } : {}), manualReviewRequired: payload.manualReview, ...(classification ? { classifierLabel: classification.label, classifierVersion: classification.version, classifierConfidence: classification.confidence, classifierRuleIds: classification.ruleIds, classifiedAt: Date.now() } : {}), expiresAt });
        if (payload.fromMe) {
          // A seller reply closes both pending and already-missed evidence. Query
          // each state separately so every database read remains index-backed.
          for (const state of ["pending", "missed"] as const) {
            const opportunities = await ctx.db.query("missedRevenueOpportunities").withIndex("by_conversation_state", (builder) => builder.eq("conversationId", conversation._id).eq("state", state).lte("triggerAt", payload.eventAt)).take(foundationPolicy().batchSize);
            for (const opportunity of opportunities) {
              if (opportunity.scheduledId) {
                const scheduled = await ctx.db.system.get(opportunity.scheduledId);
                if (scheduled?.state.kind === "pending") await ctx.scheduler.cancel(opportunity.scheduledId);
              }
              await ctx.db.patch(opportunity._id, { state: "answered", answeredAt: payload.eventAt });
            }
            if (opportunities.length === foundationPolicy().batchSize) await ctx.scheduler.runAfter(0, internal.maintenance.answerConversationOpportunities, { conversationId: conversation._id, ownerAt: payload.eventAt, state });
          }
        } else if (classification?.label === "buying_signal") {
          const responseWindowMinutes = business.responseWindowMinutes ?? foundationPolicy().responseWindowMinutes;
          const dueAt = payload.eventAt + responseWindowMinutes * 60000;
          // Out-of-order delivery must not create a missed opportunity after a
          // seller response that is already stored for this conversation.
          if (lastOwnerAt >= payload.eventAt) {
            await ctx.db.insert("missedRevenueOpportunities", { businessId: business._id, customerId: customer._id, conversationId: conversation._id, interactionId, classifierVersion: classification.version, classifierConfidence: classification.confidence, ruleIds: classification.ruleIds, triggerAt: payload.eventAt, responseWindowMinutes, dueAt, state: "answered", answeredAt: lastOwnerAt, expiresAt });
          } else {
            const opportunityId = await ctx.db.insert("missedRevenueOpportunities", { businessId: business._id, customerId: customer._id, conversationId: conversation._id, interactionId, classifierVersion: classification.version, classifierConfidence: classification.confidence, ruleIds: classification.ruleIds, triggerAt: payload.eventAt, responseWindowMinutes, dueAt, conversationRevision: conversation.revision + 1, state: "pending", expiresAt });
            const scheduledId = await ctx.scheduler.runAfter(Math.max(0, dueAt - Date.now()), internal.readOnly.promoteOpportunity, { opportunityId });
            await ctx.db.patch(opportunityId, { scheduledId });
          }
        }
        const phase3Pending = await ctx.db.query("followUpTasks").withIndex("by_customer_status_trigger", (builder) => builder.eq("customerId", customer._id).eq("status", "pending").lte("triggerAt", payload.eventAt)).take(foundationPolicy().batchSize);
        const legacyPending = await ctx.db.query("followUpTasks").withIndex("by_customer_status", (builder) => builder.eq("customerId", customer._id).eq("status", "pending").lte("createdAt", payload.eventAt)).take(foundationPolicy().batchSize);
        const pending = Array.from(new Map([...phase3Pending, ...legacyPending].map((task) => [task._id, task])).values()).slice(0, foundationPolicy().batchSize);
        for (const task of pending) {
          const scheduledId = task.scheduledFunctionId ? ctx.db.system.normalizeId("_scheduled_functions", task.scheduledFunctionId) : null;
          const scheduled = scheduledId ? await ctx.db.system.get(scheduledId) : null;
          if (scheduledId && scheduled?.state.kind === "pending") await ctx.scheduler.cancel(scheduledId);
          await ctx.db.patch(task._id, { status: "cancelled", cancelledAt: Date.now(), cancellationReason: payload.fromMe ? "SELLER_REPLIED" : "CUSTOMER_REPLIED" });
        }
        if (phase3Pending.length === foundationPolicy().batchSize || legacyPending.length === foundationPolicy().batchSize) await ctx.scheduler.runAfter(0, internal.maintenance.cancelCustomerTasks, { customerId: customer._id, since: payload.eventAt });
        if (!payload.fromMe && classification?.label === "inquiry") await createStalledInquiryTask(ctx, { businessId: business._id, customerId: customer._id, conversationId: conversation._id, interactionId });
      }
    } else if (payload.kind === "receipt") {
      const suppression = await ctx.db.query("privacySuppressions").withIndex("by_business_identity", (builder) => builder.eq("businessId", business._id).eq("identityKey", payload.identityKey)).unique();
      // ReadSelf is the seller's device, not evidence that a buyer read a message.
      if (suppression || payload.state === "read_self" || payload.eventAt < session.consentAt || payload.eventAt + foundationPolicy().eventRetentionDays * 86400000 <= Date.now()) {
        await ctx.db.patch(event._id, { state: "ignored", errorCode: "RECEIPT_NOT_ELIGIBLE", payload: undefined, completedAt: Date.now() });
        return null;
      }
      for (const messageId of payload.messageIds) {
        if (payload.chat === "status@broadcast") {
          if (payload.state !== "read" || !payload.identityKey) continue;
          const existing = await ctx.db.query("statusObservations").withIndex("by_session_status_viewer", (builder) => builder.eq("sessionId", session._id).eq("statusMessageId", messageId).eq("viewerIdentityKey", payload.identityKey)).unique();
          if (!existing) await ctx.db.insert("statusObservations", { businessId: business._id, sessionId: session._id, statusMessageId: messageId, viewerIdentityKey: payload.identityKey, observedAt: payload.eventAt, expiresAt: event.expiresAt });
        } else {
          const existing = await ctx.db.query("deliveryReceipts").withIndex("by_session_message", (builder) => builder.eq("sessionId", session._id).eq("messageId", messageId)).unique();
          const deliveredAt = existing?.deliveredAt === undefined ? payload.eventAt : Math.min(existing.deliveredAt, payload.eventAt);
          const readAt = payload.state === "delivered" ? existing?.readAt : Math.min(existing?.readAt ?? payload.eventAt, payload.eventAt);
          if (existing) await ctx.db.patch(existing._id, { deliveredAt, ...(readAt !== undefined ? { readAt } : {}) });
          else await ctx.db.insert("deliveryReceipts", { businessId: business._id, sessionId: session._id, messageId, identityKey: payload.identityKey, deliveredAt, ...(readAt !== undefined ? { readAt } : {}), expiresAt: event.expiresAt });
        }
      }
    } else if (payload.kind === "connection") {
      if (payload.qrCiphertext && session.state !== "connected") await ctx.db.patch(session._id, { qrCiphertext: payload.qrCiphertext, qrExpiresAt: Date.now() + foundationPolicy().qrLifetimeMs, state: "pending", updatedAt: Date.now() });
      if (payload.event !== "QRCode" && session.providerInstanceId) {
        await ctx.db.patch(session._id, { nextHealthAt: Date.now(), lastError: "CONNECTION_RECHECK_PENDING" });
        await ctx.scheduler.runAfter(0, internal.connections.checkHealth, { sessionId: session._id, generation: session.generation });
      }
    }
    await ctx.db.patch(event._id, { state: payload.kind === "ignored" ? "ignored" : "processed", payload: undefined, completedAt: Date.now(), errorCode: payload.kind === "ignored" ? payload.reason : undefined });
    logEvent("event_processed", { correlationId: event.correlationId, businessId: event.businessId, eventId: event._id, attempt: event.attempts });
    return null;
  },
});

export const failEvent = internalMutation({
  args: { eventId: v.id("inboundEvents"), attempt: v.number(), jitterMs: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.state !== "processing" || event.attempts !== args.attempt) return null;
    const exhausted = event.attempts >= (event.retryLimit ?? foundationPolicy().retryAttempts) || event.expiresAt <= Date.now();
    const delay = Math.min(300000, foundationPolicy().retryBaseMs * 2 ** (event.attempts - 1)) + Math.max(0, Math.min(args.jitterMs, foundationPolicy().retryBaseMs));
    const scheduledId = exhausted ? undefined : await ctx.scheduler.runAfter(delay, internal.ingestion.runEvent, { eventId: event._id });
    await ctx.db.patch(event._id, { state: exhausted ? "dead_letter" : "pending", errorCode: "EVENT_PROCESSING_FAILED", dueAt: Date.now() + delay, ...(scheduledId ? { scheduledId } : {}) });
    logEvent(exhausted ? "event_dead_letter" : "event_retry", { correlationId: event.correlationId, businessId: event.businessId, eventId: event._id, attempt: event.attempts, code: "EVENT_PROCESSING_FAILED" });
    return null;
  },
});

export const runEvent = internalAction({
  args: { eventId: v.id("inboundEvents") }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const event: Infer<typeof eventDocument> | null = await ctx.runMutation(internal.ingestion.claimEvent, args);
    if (!event) return null;
    try {
      await ctx.runMutation(internal.ingestion.applyEvent, { eventId: event._id, attempt: event.attempts });
    } catch {
      await ctx.runMutation(internal.ingestion.failEvent, { eventId: event._id, attempt: event.attempts, jitterMs: Math.floor(Math.random() * foundationPolicy().retryBaseMs) });
    }
    return null;
  },
});
