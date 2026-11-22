import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { components, internal } from "./_generated/api";

export const accountDeletionPreparation = internalQuery({
  args: { businessId: v.id("businesses") },
  returns: v.union(v.null(), v.object({
    businessId: v.id("businesses"), businessName: v.string(), ownerId: v.string(),
    subscriptionStatus: v.union(v.string(), v.null()), subscriptionCode: v.union(v.string(), v.null()),
    emailTokenCiphertext: v.union(v.string(), v.null()),
  })),
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) return null;
    const subscription = await ctx.db.query("businessSubscriptions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique();
    return {
      businessId: business._id, businessName: business.name, ownerId: business.ownerId,
      subscriptionStatus: subscription?.status ?? null, subscriptionCode: subscription?.providerSubscriptionCode ?? null,
      emailTokenCiphertext: subscription?.providerEmailTokenCiphertext ?? null,
    };
  },
});

export const beginAccountDeletion = internalMutation({
  args: { businessId: v.id("businesses"), requestedBy: v.string() },
  returns: v.id("adminAccountDeletionJobs"),
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError({ code: "BUSINESS_NOT_FOUND" });
    const existing = await ctx.db.query("adminAccountDeletionJobs").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique();
    if (existing && existing.state !== "dead_letter") return existing._id;
    const now = Date.now();
    await ctx.db.patch(business._id, { foundationVersion: 0, killSwitch: true, aiEnabled: false, customerAutoReplyEnabled: false, groupAutoReplyEnabled: false, whatsappStatus: "disconnected" });
    const session = await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique();
    if (session && session.state !== "revoked") {
      const disconnectDueAt = Math.max(now, session.operationLeaseUntil ?? 0) + 1_000;
      await ctx.db.patch(session._id, { state: "revoked", updatedAt: now, qrCiphertext: undefined, qrExpiresAt: undefined, disconnectAttempts: 0, disconnectDueAt });
      await ctx.scheduler.runAfter(Math.max(0, disconnectDueAt - now), internal.connections.disconnectRevoked, { sessionId: session._id, generation: session.generation });
    }
    const jobId = existing ? existing._id : await ctx.db.insert("adminAccountDeletionJobs", {
      businessId: business._id, businessName: business.name, ownerId: business.ownerId, requestedBy: args.requestedBy,
      requestedAt: now, state: "pending", phase: 0, deletedRecords: 0, updatedAt: now,
    });
    if (existing) await ctx.db.patch(existing._id, { state: "pending", phase: 0, deletedRecords: 0, updatedAt: now, completedAt: undefined, errorCode: undefined, requestedBy: args.requestedBy, requestedAt: now });
    const subscription = await ctx.db.query("businessSubscriptions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique();
    if (subscription) await ctx.db.patch(subscription._id, { status: "cancelled", cancelAtPeriodEnd: true, cancelledAt: now, updatedAt: now });
    const scheduledId = await ctx.scheduler.runAfter(1_500, internal.adminDeletion.deleteAccountBatch, { jobId });
    await ctx.db.patch(jobId, { scheduledId });
    return jobId;
  },
});

const deletionTables = [
  "customers", "contactAliases", "orders", "inventory", "interactions", "statuses", "statusViews", "automations", "followUpTasks", "messageTemplates", "automationRuns", "actionOutcomes", "sellerActionEvents", "revenueAttributions", "aiActivityLog", "managedGroups", "assistantDispatches", "dailySnapshots", "disconnectionAlerts", "inboundEvents", "communityOpportunities", "handoffEvents", "knowledgeSuggestions", "privacySuppressions", "deletionJobs", "deliveryReceipts", "statusObservations", "foundationAudit", "businessAiUsage", "billingCheckoutIntents", "billingWebhookEvents", "billingPayments", "billingUsagePeriods", "billingUsageConversations", "missedRevenueOpportunities", "messageLabels", "businessKnowledge", "customerMemories", "conversationCommitments", "paymentProofs", "commerceExceptions", "ownerRescueRequests", "negotiationPolicies", "leadQualifications", "conversationOutcomes",
] as const;

export const deleteAccountBatch = internalMutation({
  args: { jobId: v.id("adminAccountDeletionJobs") }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.state === "done" || job.state === "dead_letter") return null;
    const business = await ctx.db.get(job.businessId);
    if (!business) { await ctx.db.patch(job._id, { state: "done", completedAt: Date.now(), updatedAt: Date.now() }); return null; }
    try {
      const phase = job.phase;
      if (phase < deletionTables.length) {
        const table = deletionTables[phase];
        const records = await ctx.db.query(table).withIndex("by_business", (builder) => builder.eq("businessId", job.businessId)).take(25);
        for (const record of records) {
          if (table === "followUpTasks" && "scheduledFunctionId" in record && typeof record.scheduledFunctionId === "string") {
            const scheduledId = ctx.db.system.normalizeId("_scheduled_functions", record.scheduledFunctionId);
            const scheduled = scheduledId ? await ctx.db.system.get(scheduledId) : null;
            if (scheduledId && scheduled?.state.kind === "pending") await ctx.scheduler.cancel(scheduledId);
          }
          if ((table === "missedRevenueOpportunities" || table === "deletionJobs") && "scheduledId" in record && record.scheduledId) {
            const scheduled = await ctx.db.system.get(record.scheduledId);
            if (scheduled?.state.kind === "pending") await ctx.scheduler.cancel(record.scheduledId);
          }
          await ctx.db.delete(record._id);
        }
        const scheduledId = await ctx.scheduler.runAfter(0, internal.adminDeletion.deleteAccountBatch, args);
        await ctx.db.patch(job._id, { state: "running", phase: records.length === 25 ? phase : phase + 1, deletedRecords: job.deletedRecords + records.length, updatedAt: Date.now(), scheduledId });
        return null;
      }
      const conversations = await ctx.db.query("conversations").withIndex("by_business_activity", (builder) => builder.eq("businessId", job.businessId)).take(10);
      if (conversations.length > 0) {
        for (const conversation of conversations) {
          if (conversation.agentThreadId) await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, { threadId: conversation.agentThreadId });
          await ctx.db.delete(conversation._id);
        }
        const scheduledId = await ctx.scheduler.runAfter(0, internal.adminDeletion.deleteAccountBatch, args);
        await ctx.db.patch(job._id, { state: "running", deletedRecords: job.deletedRecords + conversations.length, updatedAt: Date.now(), scheduledId });
        return null;
      }
      const session = await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", job.businessId)).unique();
      if (session) {
        if (!session.disconnectedAt && session.providerInstanceId) {
          if ((session.disconnectAttempts ?? 0) >= 5 || session.lastError === "PROVIDER_DISCONNECT_DEAD_LETTER") { await ctx.db.patch(job._id, { state: "dead_letter", errorCode: "PROVIDER_DISCONNECT_UNCONFIRMED", updatedAt: Date.now() }); return null; }
          const scheduledId = await ctx.scheduler.runAfter(5_000, internal.adminDeletion.deleteAccountBatch, args);
          await ctx.db.patch(job._id, { state: "running", updatedAt: Date.now(), scheduledId });
          return null;
        }
        await ctx.db.delete(session._id);
      }
      const subscription = await ctx.db.query("businessSubscriptions").withIndex("by_business", (builder) => builder.eq("businessId", job.businessId)).unique();
      if (subscription) await ctx.db.delete(subscription._id);
      if (job.ownerId.startsWith("credentials:")) {
        const userId = ctx.db.normalizeId("users", job.ownerId.slice("credentials:".length));
        if (userId) {
          for (const account of await ctx.db.query("accounts").withIndex("by_userId", (builder) => builder.eq("userId", userId)).take(25)) await ctx.db.delete(account._id);
          for (const authSession of await ctx.db.query("sessions").withIndex("by_userId", (builder) => builder.eq("userId", userId)).take(25)) await ctx.db.delete(authSession._id);
          if (await ctx.db.get(userId)) await ctx.db.delete(userId);
        }
      }
      await ctx.db.delete(business._id);
      await ctx.db.patch(job._id, { state: "done", completedAt: Date.now(), updatedAt: Date.now(), deletedRecords: job.deletedRecords + 1, scheduledId: undefined });
      return null;
    } catch (error) {
      await ctx.db.patch(job._id, { state: "dead_letter", errorCode: error instanceof Error ? error.message.slice(0, 120) : "ACCOUNT_DELETION_FAILED", updatedAt: Date.now() });
      return null;
    }
  },
});
