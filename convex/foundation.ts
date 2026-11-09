import { ConvexError, v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireBusiness, requireIdentity } from "./lib/authorization";
import { DISCLOSURE_VERSION, foundationPolicy } from "./lib/policy";
import { connectionState, sessionDocument } from "./lib/validators";
import type { Id } from "./_generated/dataModel";

export const workspace = query({
  args: {},
  returns: v.union(v.null(), v.object({ businessId: v.id("businesses"), name: v.string(), timezone: v.string(), retentionDays: v.number(), responseWindowMinutes: v.number(), state: connectionState, lastError: v.union(v.string(), v.null()), lastHealthAt: v.union(v.number(), v.null()) })),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const business = await ctx.db.query("businesses").withIndex("by_owner", (builder) => builder.eq("ownerId", identity.subject)).unique();
    if (!business || business.foundationVersion !== 1) return null;
    const session = await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique();
    return { businessId: business._id, name: business.name, timezone: business.timezone ?? "Africa/Lagos", retentionDays: business.messageRetentionDays ?? foundationPolicy().messageRetentionDays, responseWindowMinutes: business.responseWindowMinutes ?? foundationPolicy().responseWindowMinutes, state: session?.state ?? "disconnected", lastError: session?.lastError ?? null, lastHealthAt: session?.lastHealthAt ?? null };
  },
});

export const createBusiness = mutation({
  args: { name: v.string() }, returns: v.id("businesses"),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 100) throw new ConvexError({ code: "INVALID_BUSINESS_NAME" });
    const existing = await ctx.db.query("businesses").withIndex("by_owner", (builder) => builder.eq("ownerId", identity.subject)).unique();
    if (existing) {
      if (existing.foundationVersion !== 1) throw new ConvexError({ code: "OWNER_MIGRATION_REQUIRED" });
      return existing._id;
    }
    return await ctx.db.insert("businesses", { name, ownerId: identity.subject, whatsappStatus: "disconnected", whatsappMode: "unofficial", onboardingStep: 1, foundationVersion: 1, timezone: "Africa/Lagos", messageRetentionDays: foundationPolicy().messageRetentionDays, killSwitch: true, aiEnabled: false });
  },
});

export const customers = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ customerId: v.id("customers"), name: v.string(), identity: v.string(), lastActivityAt: v.number(), firstInboundAt: v.union(v.number(), v.null()) })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const conversations = await ctx.db.query("conversations").withIndex("by_business_activity", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(50);
    const output: { customerId: Id<"customers">; name: string; identity: string; lastActivityAt: number; firstInboundAt: number | null }[] = [];
    for (const conversation of conversations) {
      const customer = await ctx.db.get(conversation.customerId);
      if (customer && customer.businessId === args.businessId && customer.deletedAt === undefined) output.push({ customerId: customer._id, name: customer.name || "Unnamed customer", identity: customer.phone, lastActivityAt: conversation.lastEventAt, firstInboundAt: customer.firstInboundAt ?? null });
    }
    return output;
  },
});

export const messages = query({
  args: { businessId: v.id("businesses"), customerId: v.id("customers") },
  returns: v.array(v.object({ messageId: v.id("interactions"), role: v.union(v.literal("customer"), v.literal("owner"), v.literal("system")), text: v.string(), timestamp: v.number(), manualReview: v.boolean(), type: v.string() })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId || customer.deletedAt !== undefined) throw new ConvexError({ code: "NOT_FOUND" });
    const messages = await ctx.db.query("interactions").withIndex("by_customer", (builder) => builder.eq("customerId", args.customerId)).order("desc").take(100);
    return messages.filter((message) => message.businessId === args.businessId).map((message) => ({ messageId: message._id, role: message.role, text: message.content, timestamp: message.timestamp, manualReview: message.manualReviewRequired ?? false, type: message.messageType ?? "unsupported" }));
  },
});

export const failures = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ eventId: v.id("inboundEvents"), correlationId: v.string(), attempts: v.number(), code: v.string(), receivedAt: v.number(), retryable: v.boolean() })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const failures = await ctx.db.query("inboundEvents").withIndex("by_business_state", (builder) => builder.eq("businessId", args.businessId).eq("state", "dead_letter")).order("desc").take(20);
    return failures.map((event) => ({ eventId: event._id, correlationId: event.correlationId, attempts: event.attempts, code: event.errorCode ?? "PROCESSING_FAILED", receivedAt: event.receivedAt, retryable: event.payload !== undefined }));
  },
});

export const retryEvent = mutation({
  args: { businessId: v.id("businesses"), eventId: v.id("inboundEvents") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const event = await ctx.db.get(args.eventId);
    if (!event || event.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    if (event.state !== "dead_letter") return null;
    if (!event.payload || event.expiresAt <= Date.now()) throw new ConvexError({ code: "EVENT_EXPIRED" });
    const scheduledId = await ctx.scheduler.runAfter(0, internal.ingestion.runEvent, { eventId: event._id });
    // Keep attempt numbers monotonic across manual retries so an old in-flight
    // completion cannot match a newly issued claim after retry exhaustion.
    await ctx.db.patch(event._id, { state: "pending", retryLimit: event.attempts + foundationPolicy().retryAttempts, dueAt: Date.now(), errorCode: undefined, scheduledId });
    await ctx.db.insert("foundationAudit", { businessId: args.businessId, kind: "event_replayed", correlationId: event.correlationId, at: Date.now(), expiresAt: Date.now() + foundationPolicy().eventRetentionDays * 86400000 });
    return null;
  },
});

export const deleteCustomer = mutation({
  args: { businessId: v.id("businesses"), customerId: v.id("customers") }, returns: v.id("deletionJobs"),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId || !customer.identityKey) throw new ConvexError({ code: "NOT_FOUND" });
    const existing = await ctx.db.query("deletionJobs").withIndex("by_customer", (builder) => builder.eq("customerId", args.customerId)).unique();
    if (existing) return existing._id;
    const identityKey = customer.identityKey;
    const suppression = await ctx.db.query("privacySuppressions").withIndex("by_business_identity", (builder) => builder.eq("businessId", args.businessId).eq("identityKey", identityKey)).unique();
    if (!suppression) await ctx.db.insert("privacySuppressions", { businessId: args.businessId, identityKey: customer.identityKey, createdAt: Date.now() });
    await ctx.db.patch(customer._id, { deletedAt: Date.now(), name: undefined, phone: "deleted", tags: [], memoryIgnoredOffers: undefined, memoryLastAskedTopic: undefined, memoryLastObjection: undefined, memoryPreferredCategory: undefined });
    const jobId = await ctx.db.insert("deletionJobs", { businessId: args.businessId, customerId: args.customerId, requestedAt: Date.now(), state: "pending", attempts: 1, dueAt: Date.now() });
    const scheduledId = await ctx.scheduler.runAfter(0, internal.maintenance.deleteCustomerBatch, { jobId });
    await ctx.db.patch(jobId, { scheduledId });
    return jobId;
  },
});

export const ownedSession = internalQuery({
  args: { businessId: v.id("businesses") }, returns: v.union(v.null(), sessionDocument),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    return await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).unique();
  },
});

export const sessionById = internalQuery({
  args: { sessionId: v.id("whatsappSessions") }, returns: v.union(v.null(), sessionDocument),
  handler: async (ctx, args) => ctx.db.get(args.sessionId),
});

export const sessionByProvider = internalQuery({
  args: { providerInstanceId: v.string() }, returns: v.union(v.null(), sessionDocument),
  handler: async (ctx, args) => ctx.db.query("whatsappSessions").withIndex("by_provider", (builder) => builder.eq("providerInstanceId", args.providerInstanceId)).unique(),
});

export const prepareSession = internalMutation({
  args: { businessId: v.id("businesses"), tokenCiphertext: v.string(), tokenHash: v.string(), disclosureVersion: v.string() },
  returns: v.object({ sessionId: v.id("whatsappSessions"), claimed: v.boolean() }),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    if (args.disclosureVersion !== DISCLOSURE_VERSION) throw new ConvexError({ code: "DISCLOSURE_REQUIRED" });
    const existing = await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).unique();
    const now = Date.now();
    if (existing) {
      if (existing.state === "connected") return { sessionId: existing._id, claimed: false };
      if (existing.state === "revoked") throw new ConvexError({ code: "SESSION_REVOKED_REQUIRES_OPERATOR_RESET" });
      if ((existing.operationLeaseUntil ?? 0) > now) return { sessionId: existing._id, claimed: false };
      // Fence connection attempts without invalidating accepted message jobs.
      await ctx.db.patch(existing._id, { operationLeaseUntil: now + foundationPolicy().providerTimeoutMs * 5, operationVersion: (existing.operationVersion ?? 0) + 1, disclosureVersion: args.disclosureVersion, updatedAt: now });
      return { sessionId: existing._id, claimed: true };
    }
    const sessionId = await ctx.db.insert("whatsappSessions", { businessId: args.businessId, instanceName: `pipelixr-${args.businessId}`, generation: 1, state: "provisioning", tokenCiphertext: args.tokenCiphertext, tokenHash: args.tokenHash, disclosureVersion: args.disclosureVersion, consentAt: now, createdAt: now, updatedAt: now, nextHealthAt: now + foundationPolicy().healthIntervalMs, operationLeaseUntil: now + foundationPolicy().providerTimeoutMs * 5 });
    await ctx.db.patch(args.businessId, { disclosureVersion: args.disclosureVersion, onboardingStep: 2 });
    return { sessionId, claimed: true };
  },
});

export const updateSession = internalMutation({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number(), operationVersion: v.optional(v.number()), state: connectionState, providerInstanceId: v.optional(v.string()), code: v.optional(v.string()), health: v.optional(v.boolean()), qrCiphertext: v.optional(v.string()), completeOperation: v.optional(v.boolean()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.generation !== args.generation || (args.operationVersion !== undefined && args.operationVersion !== (session.operationVersion ?? 0))) return null;
    if (args.providerInstanceId) {
      const linked = await ctx.db.query("whatsappSessions").withIndex("by_provider", (builder) => builder.eq("providerInstanceId", args.providerInstanceId)).unique();
      if (linked && linked._id !== session._id) throw new ConvexError({ code: "INSTANCE_ALREADY_BOUND" });
    }
    // A create response can arrive after revocation. Retain its binding for the
    // delayed disconnect, but never reactivate local ingestion.
    if (session.state === "revoked") {
      if (args.providerInstanceId) await ctx.db.patch(session._id, { providerInstanceId: args.providerInstanceId });
      return null;
    }
    await ctx.db.patch(session._id, {
      state: args.state, updatedAt: Date.now(), lastError: args.code,
      ...(args.completeOperation ? { operationLeaseUntil: undefined } : {}),
      ...(args.providerInstanceId ? { providerInstanceId: args.providerInstanceId } : {}),
      ...(args.health ? { lastHealthAt: Date.now(), nextHealthAt: Date.now() + foundationPolicy().healthIntervalMs } : {}),
      ...(args.qrCiphertext ? { qrCiphertext: args.qrCiphertext, qrExpiresAt: Date.now() + foundationPolicy().qrLifetimeMs } : {}),
      ...(args.state === "connected" || args.state === "disconnected" ? { qrCiphertext: undefined, qrExpiresAt: undefined } : {}),
    });
    await ctx.db.patch(session.businessId, { whatsappStatus: args.state === "connected" ? "connected" : args.state === "error" ? "error" : args.state === "pending" ? "pending" : "disconnected" });
    return null;
  },
});

export const revokeSession = mutation({
  args: { businessId: v.id("businesses") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const session = await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).unique();
    if (!session || session.state === "revoked") return null;
    await ctx.db.patch(session._id, { state: "revoked", updatedAt: Date.now(), qrCiphertext: undefined, qrExpiresAt: undefined, disconnectAttempts: 0, disconnectDueAt: Math.max(Date.now(), session.operationLeaseUntil ?? 0) + foundationPolicy().providerTimeoutMs });
    await ctx.db.patch(args.businessId, { whatsappStatus: "disconnected", killSwitch: true });
    await ctx.scheduler.runAfter(Math.max(0, (session.operationLeaseUntil ?? 0) - Date.now()) + foundationPolicy().providerTimeoutMs, internal.connections.disconnectRevoked, { sessionId: session._id, generation: session.generation });
    return null;
  },
});

export const markCreateAttempt = internalMutation({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.generation !== args.generation || session.state === "revoked" || session.createAttemptedAt !== undefined) return false;
    await ctx.db.patch(session._id, { createAttemptedAt: Date.now() });
    return true;
  },
});

export const recordDisconnectFailure = internalMutation({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number(), code: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.generation !== args.generation || session.state !== "revoked") return null;
    const attempts = session.disconnectAttempts ?? 0;
    const exhausted = attempts >= foundationPolicy().retryAttempts;
    if (exhausted) {
      await ctx.db.patch(session._id, { lastError: "PROVIDER_DISCONNECT_DEAD_LETTER", disconnectDueAt: undefined, updatedAt: Date.now() });
      const existing = await ctx.db.query("foundationAudit").withIndex("by_business_time", (builder) => builder.eq("businessId", session.businessId)).order("desc").take(20);
      if (!existing.some((entry) => entry.kind === "disconnect_dead_letter" && entry.correlationId === session._id)) {
        await ctx.db.insert("foundationAudit", { businessId: session.businessId, kind: "disconnect_dead_letter", correlationId: session._id, code: args.code, at: Date.now(), expiresAt: Date.now() + foundationPolicy().eventRetentionDays * 86400000 });
      }
      return null;
    }
    const delay = foundationPolicy().retryBaseMs * 2 ** Math.max(0, attempts - 1);
    const disconnectDueAt = Date.now() + delay;
    const scheduledId = await ctx.scheduler.runAfter(delay, internal.connections.disconnectRevoked, { sessionId: session._id, generation: session.generation });
    await ctx.db.patch(session._id, { lastError: args.code, disconnectDueAt, updatedAt: Date.now() });
    void scheduledId;
    return null;
  },
});

// Persist attempts before the provider call. Maintenance can recover an action
// that terminates after claiming, without relying on action-level auto-retries.
export const claimDisconnect = internalMutation({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number() },
  returns: v.union(v.null(), sessionDocument),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.generation !== args.generation || session.state !== "revoked" || session.disconnectedAt || (session.disconnectDueAt ?? 0) > Date.now()) return null;
    const attempts = session.disconnectAttempts ?? 0;
    if (attempts >= foundationPolicy().retryAttempts) {
      if (session.lastError !== "PROVIDER_DISCONNECT_DEAD_LETTER") {
        await ctx.db.patch(session._id, { lastError: "PROVIDER_DISCONNECT_DEAD_LETTER" });
        await ctx.db.insert("foundationAudit", { businessId: session.businessId, kind: "disconnect_dead_letter", correlationId: session._id, code: "PROVIDER_DISCONNECT_DEAD_LETTER", at: Date.now(), expiresAt: Date.now() + foundationPolicy().eventRetentionDays * 86400000 });
      }
      return null;
    }
    // The due timestamp is a lease for crash recovery. A retry is scheduled only
    // after a definite failure, never before the provider outcome is known.
    await ctx.db.patch(session._id, { disconnectAttempts: attempts + 1, disconnectDueAt: Date.now() + foundationPolicy().leaseMs });
    return await ctx.db.get(session._id);
  },
});

export const completeDisconnect = internalMutation({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (session?.state === "revoked" && session.generation === args.generation) {
      // Revoked sessions cannot reconnect; remove their credential after cleanup.
      await ctx.db.patch(session._id, { disconnectedAt: Date.now(), disconnectDueAt: undefined, tokenCiphertext: "", tokenHash: "", lastError: undefined, operationLeaseUntil: undefined });
    }
    return null;
  },
});

export const privacyJobs = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ jobId: v.id("deletionJobs"), state: v.union(v.literal("pending"), v.literal("done"), v.literal("dead_letter")), requestedAt: v.number(), code: v.union(v.string(), v.null()) })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const jobs = await ctx.db.query("deletionJobs").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(20);
    return jobs.map((job) => ({ jobId: job._id, state: job.state, requestedAt: job.requestedAt, code: job.errorCode ?? null }));
  },
});

export const retryDeletion = mutation({
  args: { businessId: v.id("businesses"), jobId: v.id("deletionJobs") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    if (job.state !== "dead_letter") return null;
    const scheduledId = await ctx.scheduler.runAfter(0, internal.maintenance.deleteCustomerBatch, { jobId: job._id });
    await ctx.db.patch(job._id, { state: "pending", attempts: 1, dueAt: Date.now(), scheduledId, errorCode: undefined });
    return null;
  },
});
