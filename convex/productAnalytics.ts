import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireBusiness, requireIdentity } from "./lib/authorization";

type Milestone =
  | "firstConnectedAt"
  | "firstUsefulOpportunityAt"
  | "firstSuggestedActionAt"
  | "firstSuggestedActionCompletedAt"
  | "automationOptInAt";

function mondayUtc(timestamp: number): number {
  const date = new Date(timestamp);
  const day = date.getUTCDay() || 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1);
}

async function productMetrics(ctx: MutationCtx, business: Doc<"businesses">) {
  const existing = await ctx.db.query("businessProductMetrics").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique();
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("businessProductMetrics", {
    businessId: business._id,
    businessCreatedAt: business._creationTime,
    createdAt: now,
    updatedAt: now,
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("PRODUCT_METRICS_NOT_CREATED");
  return created;
}

export async function recordMilestone(ctx: MutationCtx, businessId: Id<"businesses">, milestone: Milestone, at = Date.now()) {
  const business = await ctx.db.get(businessId);
  if (!business) return;
  const metrics = await productMetrics(ctx, business);
  if (metrics[milestone] !== undefined) return;
  await ctx.db.patch(metrics._id, { [milestone]: at, updatedAt: Date.now() });
}

export async function recordBusinessActivity(ctx: MutationCtx, businessId: Id<"businesses">, at = Date.now()) {
  const weekStart = mondayUtc(at);
  const existing = await ctx.db.query("businessActivityWeeks").withIndex("by_business_week", (builder) => builder.eq("businessId", businessId).eq("weekStart", weekStart)).unique();
  if (existing) {
    await ctx.db.patch(existing._id, { lastSeenAt: Math.max(existing.lastSeenAt, at), activityCount: existing.activityCount + 1 });
    return;
  }
  await ctx.db.insert("businessActivityWeeks", { businessId, weekStart, firstSeenAt: at, lastSeenAt: at, activityCount: 1 });
}

export async function recordConnectionTransition(ctx: MutationCtx, args: {
  businessId: Id<"businesses">;
  sessionId: Id<"whatsappSessions">;
  previousState: string;
  currentState: string;
  code?: string;
  at?: number;
}) {
  const at = args.at ?? Date.now();
  if (args.currentState === "connected") {
    await recordMilestone(ctx, args.businessId, "firstConnectedAt", at);
    const active = await ctx.db.query("connectionIncidents").withIndex("by_business_status", (builder) => builder.eq("businessId", args.businessId).eq("status", "active")).order("desc").take(20);
    for (const incident of active) {
      if (incident.sessionId === args.sessionId) await ctx.db.patch(incident._id, { status: "resolved", currentState: args.currentState, updatedAt: at, resolvedAt: at });
    }
    return;
  }
  if (!['disconnected', 'error'].includes(args.currentState)) return;
  const active = await ctx.db.query("connectionIncidents").withIndex("by_business_status", (builder) => builder.eq("businessId", args.businessId).eq("status", "active")).order("desc").take(20);
  const existing = active.find((incident) => incident.sessionId === args.sessionId);
  const kind = args.currentState === "error" ? (args.code ? "provider_error" as const : "health_failure" as const) : "disconnection" as const;
  if (existing) {
    await ctx.db.patch(existing._id, { currentState: args.currentState, kind, code: args.code, updatedAt: at });
    return;
  }
  await ctx.db.insert("connectionIncidents", {
    businessId: args.businessId,
    sessionId: args.sessionId,
    status: "active",
    kind,
    previousState: args.previousState,
    currentState: args.currentState,
    ...(args.code ? { code: args.code } : {}),
    startedAt: at,
    updatedAt: at,
  });
}

export async function recordResponseTime(ctx: MutationCtx, args: {
  businessId: Id<"businesses">;
  conversationId: Id<"conversations">;
  responseInteractionId: Id<"interactions">;
  responseAt: number;
  source: "owner" | "assistant";
}) {
  const exists = await ctx.db.query("responseTimeSamples").withIndex("by_response_interaction", (builder) => builder.eq("responseInteractionId", args.responseInteractionId)).unique();
  if (exists) return;
  const candidates = await ctx.db.query("interactions").withIndex("by_conversation", (builder) => builder.eq("conversationId", args.conversationId).lt("timestamp", args.responseAt)).order("desc").take(20);
  const inbound = candidates.find((interaction) => interaction.role === "customer");
  if (!inbound || inbound.businessId !== args.businessId) return;
  const alreadyAnswered = await ctx.db.query("responseTimeSamples").withIndex("by_inbound_interaction", (builder) => builder.eq("inboundInteractionId", inbound._id)).unique();
  if (alreadyAnswered) return;
  await ctx.db.insert("responseTimeSamples", {
    businessId: args.businessId,
    conversationId: args.conversationId,
    inboundInteractionId: inbound._id,
    responseInteractionId: args.responseInteractionId,
    source: args.source,
    inboundAt: inbound.timestamp,
    responseAt: args.responseAt,
    responseMs: Math.max(0, args.responseAt - inbound.timestamp),
  });
}

export async function recordDuplicateDispatch(ctx: MutationCtx, dispatchId: Id<"assistantDispatches">, providerMessageId?: string) {
  if (!providerMessageId) return;
  const dispatch = await ctx.db.get(dispatchId);
  if (!dispatch) return;
  const matches = await ctx.db.query("assistantDispatches").withIndex("by_business_provider_message", (builder) => builder.eq("businessId", dispatch.businessId).eq("providerMessageId", providerMessageId)).take(5);
  const original = matches.find((candidate) => candidate._id !== dispatch._id);
  if (original) await ctx.db.patch(dispatch._id, { duplicateOfDispatchId: original._id, duplicateDetectedAt: Date.now() });
}

export const touchWorkspace = mutation({
  args: { businessId: v.id("businesses") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    await productMetrics(ctx, business);
    await recordBusinessActivity(ctx, args.businessId);
    return null;
  },
});

export const demoState = query({
  args: { businessId: v.id("businesses") },
  returns: v.object({ completedAt: v.union(v.number(), v.null()), dismissedAt: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const metrics = await ctx.db.query("businessProductMetrics").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).unique();
    return { completedAt: metrics?.demoCompletedAt ?? null, dismissedAt: metrics?.demoDismissedAt ?? null };
  },
});

export const recordDemo = mutation({
  args: { businessId: v.id("businesses"), outcome: v.union(v.literal("completed"), v.literal("dismissed")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const metrics = await productMetrics(ctx, business);
    const now = Date.now();
    await ctx.db.patch(metrics._id, args.outcome === "completed" ? { demoCompletedAt: metrics.demoCompletedAt ?? now, updatedAt: now } : { demoDismissedAt: metrics.demoDismissedAt ?? now, updatedAt: now });
    await recordBusinessActivity(ctx, args.businessId, now);
    return null;
  },
});

export const replyFeedback = mutation({
  args: { businessId: v.id("businesses"), interactionId: v.id("interactions"), rating: v.union(v.literal("correct"), v.literal("wrong"), v.literal("unsupported")) },
  returns: v.id("assistantReplyFeedback"),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const identity = await requireIdentity(ctx);
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.businessId !== args.businessId || interaction.role !== "owner" || !interaction.assistantDispatchId) throw new ConvexError({ code: "NOT_ASSISTANT_REPLY" });
    const dispatch = await ctx.db.get(interaction.assistantDispatchId);
    if (!dispatch || dispatch.businessId !== args.businessId || dispatch.interactionId === interaction._id || (dispatch.kind ?? "assistant_reply") !== "assistant_reply") throw new ConvexError({ code: "NOT_ASSISTANT_REPLY" });
    const existing = await ctx.db.query("assistantReplyFeedback").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).unique();
    const values = { businessId: args.businessId, interactionId: interaction._id, dispatchId: dispatch._id, rating: args.rating, recordedBy: identity.subject, recordedAt: Date.now() };
    if (existing) { await ctx.db.patch(existing._id, values); return existing._id; }
    return await ctx.db.insert("assistantReplyFeedback", values);
  },
});

export const incidents = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ id: v.id("connectionIncidents"), status: v.union(v.literal("active"), v.literal("resolved")), kind: v.string(), code: v.union(v.string(), v.null()), startedAt: v.number(), resolvedAt: v.union(v.number(), v.null()) })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const incidents = await ctx.db.query("connectionIncidents").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(20);
    return incidents.map((incident) => ({ id: incident._id, status: incident.status, kind: incident.kind, code: incident.code ?? null, startedAt: incident.startedAt, resolvedAt: incident.resolvedAt ?? null }));
  },
});

export const supportQueue = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ id: v.id("supportRequests"), category: v.string(), severity: v.string(), status: v.string(), summary: v.string(), createdAt: v.number(), updatedAt: v.number() })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const requests = await ctx.db.query("supportRequests").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(20);
    return requests.map((request) => ({ id: request._id, category: request.category, severity: request.severity, status: request.status, summary: request.summary, createdAt: request.createdAt, updatedAt: request.updatedAt }));
  },
});

export const createSupportRequest = mutation({
  args: {
    businessId: v.id("businesses"),
    category: v.union(v.literal("connection"), v.literal("duplicate_send"), v.literal("reply_quality"), v.literal("data_processing"), v.literal("other")),
    severity: v.union(v.literal("normal"), v.literal("urgent")),
    summary: v.string(),
    details: v.string(),
  },
  returns: v.id("supportRequests"),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const identity = await requireIdentity(ctx);
    const summary = args.summary.replaceAll("\u0000", "").trim().slice(0, 120);
    const details = args.details.replaceAll("\u0000", "").trim().slice(0, 2_000);
    if (summary.length < 5 || details.length < 10) throw new ConvexError({ code: "INVALID_SUPPORT_REQUEST" });
    const now = Date.now();
    const id = await ctx.db.insert("supportRequests", { businessId: args.businessId, category: args.category, severity: args.severity, status: "open", summary, details, createdBy: identity.subject, createdAt: now, updatedAt: now });
    await recordBusinessActivity(ctx, args.businessId, now);
    return id;
  },
});
