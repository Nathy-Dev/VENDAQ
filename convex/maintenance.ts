import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { foundationPolicy, logEvent } from "./lib/policy";

export const cancelCustomerTasks = internalMutation({
  args: { customerId: v.id("customers"), since: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const phase3Tasks = await ctx.db.query("followUpTasks").withIndex("by_customer_status_trigger", (builder) => builder.eq("customerId", args.customerId).eq("status", "pending").lte("triggerAt", args.since)).take(foundationPolicy().batchSize);
    const legacyTasks = await ctx.db.query("followUpTasks").withIndex("by_customer_status", (builder) => builder.eq("customerId", args.customerId).eq("status", "pending").lte("createdAt", args.since)).take(foundationPolicy().batchSize);
    const tasks = Array.from(new Map([...phase3Tasks, ...legacyTasks].map((task) => [task._id, task])).values()).slice(0, foundationPolicy().batchSize);
    for (const task of tasks) {
      const scheduledId = task.scheduledFunctionId ? ctx.db.system.normalizeId("_scheduled_functions", task.scheduledFunctionId) : null;
      const scheduled = scheduledId ? await ctx.db.system.get(scheduledId) : null;
      if (scheduledId && scheduled?.state.kind === "pending") await ctx.scheduler.cancel(scheduledId);
      await ctx.db.patch(task._id, { status: "cancelled", cancelledAt: Date.now(), cancellationReason: "CONVERSATION_UPDATED" });
    }
    if (phase3Tasks.length === foundationPolicy().batchSize || legacyTasks.length === foundationPolicy().batchSize) await ctx.scheduler.runAfter(0, internal.maintenance.cancelCustomerTasks, args);
    return null;
  },
});

export const answerConversationOpportunities = internalMutation({
  args: { conversationId: v.id("conversations"), ownerAt: v.number(), state: v.union(v.literal("pending"), v.literal("missed")) }, returns: v.null(),
  handler: async (ctx, args) => {
    const opportunities = await ctx.db.query("missedRevenueOpportunities").withIndex("by_conversation_state", (builder) => builder.eq("conversationId", args.conversationId).eq("state", args.state).lte("triggerAt", args.ownerAt)).take(foundationPolicy().batchSize);
    for (const opportunity of opportunities) {
      if (opportunity.scheduledId) {
        const scheduled = await ctx.db.system.get(opportunity.scheduledId);
        if (scheduled?.state.kind === "pending") await ctx.scheduler.cancel(opportunity.scheduledId);
      }
      await ctx.db.patch(opportunity._id, { state: "answered", answeredAt: args.ownerAt });
    }
    if (opportunities.length === foundationPolicy().batchSize) await ctx.scheduler.runAfter(0, internal.maintenance.answerConversationOpportunities, args);
    return null;
  },
});

export const deleteCustomerBatch = internalMutation({
  args: { jobId: v.id("deletionJobs") }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.state !== "pending") return null;
    const customer = await ctx.db.get(job.customerId);
    if (!customer || customer.businessId !== job.businessId || customer.deletedAt === undefined || !customer.identityKey) {
      await ctx.db.patch(job._id, { state: "dead_letter", errorCode: "INVALID_DELETION_JOB" });
      return null;
    }
    const messages = await ctx.db.query("interactions").withIndex("by_customer", (builder) => builder.eq("customerId", job.customerId)).take(foundationPolicy().batchSize);
    for (const message of messages) {
      if (message.businessId !== job.businessId) throw new Error("CROSS_TENANT_DELETION_BLOCKED");
      await ctx.db.delete(message._id);
    }
    const tasks = await ctx.db.query("followUpTasks").withIndex("by_customer", (builder) => builder.eq("customerId", job.customerId)).take(foundationPolicy().batchSize);
    for (const task of tasks) {
      const scheduledId = task.scheduledFunctionId ? ctx.db.system.normalizeId("_scheduled_functions", task.scheduledFunctionId) : null;
      const scheduled = scheduledId ? await ctx.db.system.get(scheduledId) : null;
      if (scheduledId && scheduled?.state.kind === "pending") await ctx.scheduler.cancel(scheduledId);
      await ctx.db.delete(task._id);
    }
    const opportunities = await ctx.db.query("missedRevenueOpportunities").withIndex("by_customer", (builder) => builder.eq("customerId", job.customerId)).take(foundationPolicy().batchSize);
    for (const opportunity of opportunities) {
      if (opportunity.scheduledId) {
        const scheduled = await ctx.db.system.get(opportunity.scheduledId);
        if (scheduled?.state.kind === "pending") await ctx.scheduler.cancel(opportunity.scheduledId);
      }
      await ctx.db.delete(opportunity._id);
    }
    const labels = await ctx.db.query("messageLabels").withIndex("by_customer", (builder) => builder.eq("customerId", job.customerId)).take(foundationPolicy().batchSize);
    for (const label of labels) await ctx.db.delete(label._id);
    const actionEvents = await ctx.db.query("sellerActionEvents").withIndex("by_customer_time", (builder) => builder.eq("customerId", job.customerId)).take(foundationPolicy().batchSize);
    for (const actionEvent of actionEvents) await ctx.db.delete(actionEvent._id);
    const attributions = await ctx.db.query("revenueAttributions").withIndex("by_customer", (builder) => builder.eq("customerId", job.customerId)).take(foundationPolicy().batchSize);
    for (const attribution of attributions) await ctx.db.delete(attribution._id);
    const orders = await ctx.db.query("orders").withIndex("by_customer", (builder) => builder.eq("customerId", job.customerId)).take(foundationPolicy().batchSize);
    for (const order of orders) await ctx.db.delete(order._id);
    // Clear queued payloads as well as displayed messages; retain only minimized
    // dedup tombstones so an already-accepted retry cannot recreate the contact.
    const identityKey = customer.identityKey;
    const events = await ctx.db.query("inboundEvents").withIndex("by_business_identity", (builder) => builder.eq("businessId", job.businessId).eq("identityKey", identityKey)).take(foundationPolicy().batchSize);
    for (const event of events) await ctx.db.patch(event._id, { state: "ignored", payload: undefined, identityKey: undefined, errorCode: "CONTACT_DELETED" });
    const receipts = await ctx.db.query("deliveryReceipts").withIndex("by_business_identity", (builder) => builder.eq("businessId", job.businessId).eq("identityKey", identityKey)).take(foundationPolicy().batchSize);
    for (const receipt of receipts) await ctx.db.delete(receipt._id);
    const views = await ctx.db.query("statusObservations").withIndex("by_business_identity", (builder) => builder.eq("businessId", job.businessId).eq("viewerIdentityKey", identityKey)).take(foundationPolicy().batchSize);
    for (const view of views) await ctx.db.delete(view._id);
    if ([messages, tasks, opportunities, labels, actionEvents, attributions, orders, events, receipts, views].some((batch) => batch.length === foundationPolicy().batchSize)) {
      const scheduledId = await ctx.scheduler.runAfter(0, internal.maintenance.deleteCustomerBatch, args);
      await ctx.db.patch(job._id, { scheduledId, attempts: 1, dueAt: Date.now() });
      return null;
    }
    const conversations = await ctx.db.query("conversations").withIndex("by_customer", (builder) => builder.eq("customerId", job.customerId)).take(10);
    for (const conversation of conversations) await ctx.db.delete(conversation._id);
    await ctx.db.patch(job._id, { state: "done", completedAt: Date.now() });
    await ctx.db.insert("foundationAudit", { businessId: job.businessId, kind: "customer_deleted", correlationId: job._id, at: Date.now(), expiresAt: Date.now() + foundationPolicy().eventRetentionDays * 86400000 });
    return null;
  },
});

export const sweep = internalMutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const batchSize = foundationPolicy().batchSize;
    const abandoned = await ctx.db.query("inboundEvents").withIndex("by_due", (builder) => builder.eq("state", "processing").lte("dueAt", now)).take(batchSize);
    for (const event of abandoned) {
      if (event.attempts >= (event.retryLimit ?? foundationPolicy().retryAttempts)) {
        await ctx.db.patch(event._id, { state: "dead_letter", errorCode: "PROCESSING_LEASE_EXHAUSTED" });
        logEvent("event_dead_letter", { correlationId: event.correlationId, businessId: event.businessId, eventId: event._id, code: "PROCESSING_LEASE_EXHAUSTED" });
      } else {
        const scheduledId = await ctx.scheduler.runAfter(0, internal.ingestion.runEvent, { eventId: event._id });
        await ctx.db.patch(event._id, { state: "pending", dueAt: now, scheduledId });
      }
    }
    const pending = await ctx.db.query("inboundEvents").withIndex("by_due", (builder) => builder.eq("state", "pending").lte("dueAt", now)).take(batchSize);
    for (const event of pending) {
      const scheduled = event.scheduledId ? await ctx.db.system.get(event.scheduledId) : null;
      if (!scheduled || ["failed", "canceled", "success"].includes(scheduled.state.kind)) {
        const scheduledId = await ctx.scheduler.runAfter(0, internal.ingestion.runEvent, { eventId: event._id });
        await ctx.db.patch(event._id, { scheduledId });
      }
    }
    const dueOpportunities = await ctx.db.query("missedRevenueOpportunities").withIndex("by_state_due", (builder) => builder.eq("state", "pending").lte("dueAt", now)).take(batchSize);
    for (const opportunity of dueOpportunities) await ctx.scheduler.runAfter(0, internal.readOnly.promoteOpportunity, { opportunityId: opportunity._id });
    const healthDue = await ctx.db.query("whatsappSessions").withIndex("by_health_due", (builder) => builder.lte("nextHealthAt", now)).take(batchSize);
    for (const session of healthDue) {
      await ctx.db.patch(session._id, { nextHealthAt: now + foundationPolicy().healthIntervalMs, ...((session.qrExpiresAt ?? Infinity) <= now ? { qrCiphertext: undefined, qrExpiresAt: undefined } : {}) });
      if (session.state !== "revoked" && session.providerInstanceId) await ctx.scheduler.runAfter(0, internal.connections.checkHealth, { sessionId: session._id, generation: session.generation });
    }
    // Recover only expired disconnect leases. This avoids duplicate actions while
    // a provider request is still in progress.
    const disconnectDue = await ctx.db.query("whatsappSessions").withIndex("by_disconnect_due", (builder) => builder.eq("state", "revoked").lte("disconnectDueAt", now)).take(batchSize);
    for (const session of disconnectDue) {
      if (!session.disconnectedAt && session.lastError !== "PROVIDER_DISCONNECT_DEAD_LETTER") {
        await ctx.db.patch(session._id, { disconnectDueAt: now + foundationPolicy().leaseMs });
        await ctx.scheduler.runAfter(0, internal.connections.disconnectRevoked, { sessionId: session._id, generation: session.generation });
      }
    }
    const deleting = await ctx.db.query("deletionJobs").withIndex("by_state", (builder) => builder.eq("state", "pending").lte("dueAt", now)).take(batchSize);
    for (const job of deleting) {
      const scheduled = job.scheduledId ? await ctx.db.system.get(job.scheduledId) : null;
      if (scheduled && ["pending", "inProgress"].includes(scheduled.state.kind)) continue;
      if (job.attempts >= foundationPolicy().retryAttempts) {
        await ctx.db.patch(job._id, { state: "dead_letter", errorCode: "DELETION_RETRY_EXHAUSTED" });
        logEvent("deletion_dead_letter", { businessId: job.businessId, correlationId: job._id, code: "DELETION_RETRY_EXHAUSTED" });
      } else {
        const delay = foundationPolicy().retryBaseMs * 2 ** job.attempts;
        const scheduledId = await ctx.scheduler.runAfter(delay, internal.maintenance.deleteCustomerBatch, { jobId: job._id });
        await ctx.db.patch(job._id, { scheduledId, attempts: job.attempts + 1, dueAt: now + delay });
      }
    }
    const expiredMessages = await ctx.db.query("interactions").withIndex("by_expiry", (builder) => builder.gt("expiresAt", 0).lte("expiresAt", now)).take(batchSize);
    for (const message of expiredMessages) {
      const label = await ctx.db.query("messageLabels").withIndex("by_interaction", (builder) => builder.eq("interactionId", message._id)).unique();
      if (label) await ctx.db.delete(label._id);
      const opportunity = await ctx.db.query("missedRevenueOpportunities").withIndex("by_interaction", (builder) => builder.eq("interactionId", message._id)).unique();
      if (opportunity) await ctx.db.delete(opportunity._id);
      const task = await ctx.db.query("followUpTasks").withIndex("by_trigger_interaction", (builder) => builder.eq("triggerInteractionId", message._id)).unique();
      if (task) await ctx.db.delete(task._id);
      await ctx.db.delete(message._id);
    }
    const expiredOpportunities = await ctx.db.query("missedRevenueOpportunities").withIndex("by_expiry", (builder) => builder.lte("expiresAt", now)).take(batchSize);
    for (const opportunity of expiredOpportunities) await ctx.db.delete(opportunity._id);
    const expiredTasks = await ctx.db.query("followUpTasks").withIndex("by_expiry", (builder) => builder.gt("expiresAt", 0).lte("expiresAt", now)).take(batchSize);
    for (const task of expiredTasks) await ctx.db.delete(task._id);
    // A TTL-expired profile may be recaptured by a genuinely new message. Unlike
    // an explicit deletion request, passive expiry does not suppress the contact.
    const expiredCustomers = await ctx.db.query("customers").withIndex("by_expiry", (builder) => builder.gt("expiresAt", 0).lte("expiresAt", now)).take(batchSize);
    for (const customer of expiredCustomers) {
      if (customer.deletedAt !== undefined) {
        await ctx.db.patch(customer._id, { expiresAt: undefined });
        continue;
      }
      const remaining = await ctx.db.query("interactions").withIndex("by_customer", (builder) => builder.eq("customerId", customer._id)).first();
      if (remaining) continue;
      const actionEvents = await ctx.db.query("sellerActionEvents").withIndex("by_customer_time", (builder) => builder.eq("customerId", customer._id)).take(batchSize);
      for (const actionEvent of actionEvents) await ctx.db.delete(actionEvent._id);
      const attributions = await ctx.db.query("revenueAttributions").withIndex("by_customer", (builder) => builder.eq("customerId", customer._id)).take(batchSize);
      for (const attribution of attributions) await ctx.db.delete(attribution._id);
      const orders = await ctx.db.query("orders").withIndex("by_customer", (builder) => builder.eq("customerId", customer._id)).take(batchSize);
      for (const order of orders) await ctx.db.delete(order._id);
      if ([actionEvents, attributions, orders].some((batch) => batch.length === batchSize)) continue;
      const conversation = await ctx.db.query("conversations").withIndex("by_customer", (builder) => builder.eq("customerId", customer._id)).unique();
      if (conversation) await ctx.db.delete(conversation._id);
      await ctx.db.delete(customer._id);
    }
    const expiredEvents = await ctx.db.query("inboundEvents").withIndex("by_expiry", (builder) => builder.lte("expiresAt", now)).take(batchSize);
    for (const event of expiredEvents) await ctx.db.delete(event._id);
    const expiredReceipts = await ctx.db.query("deliveryReceipts").withIndex("by_expiry", (builder) => builder.lte("expiresAt", now)).take(batchSize);
    for (const receipt of expiredReceipts) await ctx.db.delete(receipt._id);
    const expiredViews = await ctx.db.query("statusObservations").withIndex("by_expiry", (builder) => builder.lte("expiresAt", now)).take(batchSize);
    for (const view of expiredViews) await ctx.db.delete(view._id);
    const expiredAudit = await ctx.db.query("foundationAudit").withIndex("by_expiry", (builder) => builder.lte("expiresAt", now)).take(batchSize);
    for (const entry of expiredAudit) await ctx.db.delete(entry._id);
    const expiredAuth = await ctx.db.query("authAttempts").withIndex("by_window", (builder) => builder.lte("windowStart", now - foundationPolicy().authWindowMs)).take(batchSize);
    for (const attempt of expiredAuth) await ctx.db.delete(attempt._id);
    return null;
  },
});
