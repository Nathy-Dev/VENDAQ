import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { action, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { adminAccessConfigured, isAdmin, requireAdmin } from "./lib/adminAuthorization";
import { decryptSecret } from "./lib/crypto";
import { paystackRequest } from "./lib/paystack";

const BUSINESS_LIMIT = 500;
const LIST_LIMIT = 100;
const EVENT_LIMIT = 100;

const businessStatus = v.union(
  v.literal("disconnected"),
  v.literal("connected"),
  v.literal("error"),
  v.literal("pending"),
);

const subscriptionStatus = v.union(
  v.literal("trialing"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("cancel_at_period_end"),
  v.literal("cancelled"),
  v.literal("expired"),
  v.literal("incomplete"),
);

const businessSummary = v.object({
  id: v.id("businesses"),
  name: v.string(),
  ownerId: v.string(),
  industry: v.union(v.string(), v.null()),
  whatsappStatus: businessStatus,
  onboardingStep: v.number(),
  createdAt: v.number(),
  lastHistorySyncAt: v.union(v.number(), v.null()),
  assistantEnabled: v.boolean(),
  plan: v.string(),
  subscriptionStatus: v.string(),
  currentPeriodEnd: v.union(v.number(), v.null()),
  sessionState: v.union(v.string(), v.null()),
  sessionLastHealthAt: v.union(v.number(), v.null()),
});

const statuses = ["connected", "disconnected", "pending", "error"] as const;
const subscriptionStatuses = ["trialing", "active", "past_due", "cancel_at_period_end", "cancelled", "expired", "incomplete"] as const;

async function businessesByStatus(ctx: QueryCtx, status: (typeof statuses)[number], limit = BUSINESS_LIMIT) {
  return await ctx.db
    .query("businesses")
    .withIndex("by_whatsapp_status", (builder) => builder.eq("whatsappStatus", status))
    .order("desc")
    .take(limit);
}

async function subscriptionsByStatus(ctx: QueryCtx, status: (typeof subscriptionStatuses)[number], limit = BUSINESS_LIMIT) {
  return await ctx.db
    .query("businessSubscriptions")
    .withIndex("by_status_period_end", (builder) => builder.eq("status", status))
    .order("desc")
    .take(limit);
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function planMrr(subscription: Doc<"businessSubscriptions">) {
  if (!["active", "trialing", "past_due", "cancel_at_period_end"].includes(subscription.status)) return 0;
  return subscription.billingInterval === "annual" ? Math.round(subscription.amountKobo / 12) : subscription.amountKobo;
}

export const access = query({
  args: {},
  returns: v.object({ isAdmin: v.boolean(), configured: v.boolean() }),
  handler: async (ctx) => ({ isAdmin: await isAdmin(ctx), configured: adminAccessConfigured() }),
});

export const overview = query({
  args: { rangeDays: v.number() },
  returns: v.object({
    generatedAt: v.number(),
    rangeDays: v.number(),
    dataComplete: v.boolean(),
    businesses: v.object({ total: v.number(), connected: v.number(), disconnected: v.number(), pending: v.number(), error: v.number(), newInRange: v.number() }),
    subscriptions: v.object({ active: v.number(), trialing: v.number(), pastDue: v.number(), cancelling: v.number(), mrrKobo: v.number() }),
    revenue: v.object({ grossKobo: v.number(), refundedKobo: v.number(), netKobo: v.number(), successfulPayments: v.number() }),
    operations: v.object({ deadLetters: v.number(), failedWebhooks: v.number(), paidOutcomes: v.number(), qualifiedOutcomes: v.number() }),
    revenueTrend: v.array(v.object({ day: v.number(), grossKobo: v.number(), payments: v.number() })),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rangeDays = Math.min(90, Math.max(7, Math.floor(args.rangeDays)));
    const now = Date.now();
    const since = now - rangeDays * 86_400_000;
    const [businessGroups, subscriptionGroups, successful, refunded, deadLetters, failedWebhooks, outcomes] = await Promise.all([
      Promise.all(statuses.map((status) => businessesByStatus(ctx, status))),
      Promise.all(subscriptionStatuses.map((status) => subscriptionsByStatus(ctx, status))),
      ctx.db.query("billingPayments").withIndex("by_status_created", (builder) => builder.eq("status", "success").gte("createdAt", since)).order("desc").take(BUSINESS_LIMIT),
      ctx.db.query("billingPayments").withIndex("by_status_created", (builder) => builder.eq("status", "refunded").gte("createdAt", since)).order("desc").take(BUSINESS_LIMIT),
      ctx.db.query("inboundEvents").withIndex("by_due", (builder) => builder.eq("state", "dead_letter")).order("desc").take(EVENT_LIMIT),
      ctx.db.query("billingWebhookEvents").withIndex("by_state_received", (builder) => builder.eq("state", "failed").gte("receivedAt", since)).order("desc").take(EVENT_LIMIT),
      ctx.db.query("conversationOutcomes").withIndex("by_occurred", (builder) => builder.gte("occurredAt", since)).order("desc").take(BUSINESS_LIMIT),
    ]);
    const businesses = businessGroups.flat();
    const subscriptions = subscriptionGroups.flat();
    const grossKobo = successful.reduce((sum, payment) => sum + payment.amountKobo, 0);
    const refundedKobo = refunded.reduce((sum, payment) => sum + payment.amountKobo, 0);
    const trend = new Map<number, { grossKobo: number; payments: number }>();
    for (let index = rangeDays - 1; index >= 0; index -= 1) trend.set(startOfDay(now - index * 86_400_000), { grossKobo: 0, payments: 0 });
    for (const payment of successful) {
      const day = startOfDay(payment.paidAt ?? payment.createdAt);
      const entry = trend.get(day);
      if (entry) trend.set(day, { grossKobo: entry.grossKobo + payment.amountKobo, payments: entry.payments + 1 });
    }
    return {
      generatedAt: now,
      rangeDays,
      dataComplete: !businessGroups.some((group) => group.length === BUSINESS_LIMIT) && !subscriptionGroups.some((group) => group.length === BUSINESS_LIMIT) && successful.length < BUSINESS_LIMIT,
      businesses: {
        total: businesses.length,
        connected: businessGroups[0].length,
        disconnected: businessGroups[1].length,
        pending: businessGroups[2].length,
        error: businessGroups[3].length,
        newInRange: businesses.filter((business) => business._creationTime >= since).length,
      },
      subscriptions: {
        trialing: subscriptionGroups[0].length,
        active: subscriptionGroups[1].length,
        pastDue: subscriptionGroups[2].length,
        cancelling: subscriptionGroups[3].length,
        mrrKobo: subscriptions.reduce((sum, subscription) => sum + planMrr(subscription), 0),
      },
      revenue: { grossKobo, refundedKobo, netKobo: grossKobo - refundedKobo, successfulPayments: successful.length },
      operations: {
        deadLetters: deadLetters.length,
        failedWebhooks: failedWebhooks.length,
        paidOutcomes: outcomes.filter((outcome) => outcome.outcome === "paid").length,
        qualifiedOutcomes: outcomes.filter((outcome) => outcome.outcome === "qualified").length,
      },
      revenueTrend: [...trend.entries()].map(([day, value]) => ({ day, ...value })),
    };
  },
});

export const businesses = query({
  args: {},
  returns: v.object({ dataComplete: v.boolean(), businesses: v.array(businessSummary) }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const groups = await Promise.all(statuses.map((status) => businessesByStatus(ctx, status, LIST_LIMIT)));
    const records = groups.flat().sort((a, b) => b._creationTime - a._creationTime).slice(0, LIST_LIMIT);
    const summaries = await Promise.all(records.map(async (business) => {
      const [subscription, session] = await Promise.all([
        ctx.db.query("businessSubscriptions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique(),
        ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique(),
      ]);
      return {
        id: business._id,
        name: business.name,
        ownerId: business.ownerId,
        industry: business.industry ?? null,
        whatsappStatus: business.whatsappStatus,
        onboardingStep: business.onboardingStep,
        createdAt: business._creationTime,
        lastHistorySyncAt: business.lastHistorySyncAt ?? null,
        assistantEnabled: business.aiEnabled !== false && business.customerAutoReplyEnabled === true,
        plan: subscription?.plan ?? "free",
        subscriptionStatus: subscription?.status ?? "none",
        currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
        sessionState: session?.state ?? null,
        sessionLastHealthAt: session?.lastHealthAt ?? null,
      };
    }));
    return { dataComplete: !groups.some((group) => group.length === LIST_LIMIT), businesses: summaries };
  },
});

export const businessDetail = query({
  args: { businessId: v.id("businesses") },
  returns: v.union(v.null(), v.object({
    business: businessSummary,
    counts: v.object({ customers: v.number(), conversations: v.number(), orders: v.number(), paidOrders: v.number(), openExceptions: v.number(), openRescues: v.number() }),
    latestOrders: v.array(v.object({ id: v.id("orders"), totalAmount: v.number(), status: v.string(), createdAt: v.number() })),
  })),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const business = await ctx.db.get(args.businessId);
    if (!business) return null;
    const [subscription, session, customers, conversations, orders, openExceptions, openRescues] = await Promise.all([
      ctx.db.query("businessSubscriptions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique(),
      ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique(),
      ctx.db.query("customers").withIndex("by_business_last_interaction", (builder) => builder.eq("businessId", business._id)).take(BUSINESS_LIMIT),
      ctx.db.query("conversations").withIndex("by_business_activity", (builder) => builder.eq("businessId", business._id)).take(BUSINESS_LIMIT),
      ctx.db.query("orders").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).order("desc").take(BUSINESS_LIMIT),
      ctx.db.query("commerceExceptions").withIndex("by_business_state_severity", (builder) => builder.eq("businessId", business._id).eq("state", "open")).take(BUSINESS_LIMIT),
      ctx.db.query("ownerRescueRequests").withIndex("by_business_state_created", (builder) => builder.eq("businessId", business._id).eq("state", "open")).take(BUSINESS_LIMIT),
    ]);
    return {
      business: {
        id: business._id, name: business.name, ownerId: business.ownerId, industry: business.industry ?? null,
        whatsappStatus: business.whatsappStatus, onboardingStep: business.onboardingStep, createdAt: business._creationTime,
        lastHistorySyncAt: business.lastHistorySyncAt ?? null, assistantEnabled: business.aiEnabled !== false && business.customerAutoReplyEnabled === true,
        plan: subscription?.plan ?? "free", subscriptionStatus: subscription?.status ?? "none", currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
        sessionState: session?.state ?? null, sessionLastHealthAt: session?.lastHealthAt ?? null,
      },
      counts: { customers: customers.length, conversations: conversations.length, orders: orders.length, paidOrders: orders.filter((order) => order.status === "paid").length, openExceptions: openExceptions.length, openRescues: openRescues.length },
      latestOrders: orders.slice(0, 8).map((order) => ({ id: order._id, totalAmount: order.totalAmount, status: order.status, createdAt: order.createdAt })),
    };
  },
});

export const operations = query({
  args: {},
  returns: v.object({
    unhealthyBusinesses: v.array(v.object({ id: v.id("businesses"), name: v.string(), status: businessStatus, sessionState: v.union(v.string(), v.null()), lastHealthAt: v.union(v.number(), v.null()), lastError: v.union(v.string(), v.null()), updatedAt: v.union(v.number(), v.null()) })),
    deadLetters: v.array(v.object({ id: v.id("inboundEvents"), businessId: v.id("businesses"), businessName: v.string(), attempts: v.number(), errorCode: v.union(v.string(), v.null()), receivedAt: v.number(), dueAt: v.number() })),
    failedWebhooks: v.array(v.object({ id: v.id("billingWebhookEvents"), businessId: v.union(v.id("businesses"), v.null()), businessName: v.string(), eventType: v.string(), code: v.union(v.string(), v.null()), receivedAt: v.number() })),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [disconnected, pending, errors, deadLetters, failedWebhooks] = await Promise.all([
      businessesByStatus(ctx, "disconnected", 40),
      businessesByStatus(ctx, "pending", 40),
      businessesByStatus(ctx, "error", 40),
      ctx.db.query("inboundEvents").withIndex("by_due", (builder) => builder.eq("state", "dead_letter")).order("desc").take(40),
      ctx.db.query("billingWebhookEvents").withIndex("by_state_received", (builder) => builder.eq("state", "failed")).order("desc").take(40),
    ]);
    const unhealthy = [...errors, ...pending, ...disconnected].slice(0, 60);
    const unhealthyBusinesses = await Promise.all(unhealthy.map(async (business) => {
      const session = await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique();
      return { id: business._id, name: business.name, status: business.whatsappStatus, sessionState: session?.state ?? null, lastHealthAt: session?.lastHealthAt ?? null, lastError: session?.lastError ?? null, updatedAt: session?.updatedAt ?? null };
    }));
    const businessIds = new Set<Id<"businesses">>();
    for (const event of deadLetters) businessIds.add(event.businessId);
    for (const event of failedWebhooks) if (event.businessId) businessIds.add(event.businessId);
    const names = new Map<Id<"businesses">, string>();
    await Promise.all([...businessIds].map(async (id) => {
      const business = await ctx.db.get(id);
      names.set(id, business?.name ?? "Deleted business");
    }));
    return {
      unhealthyBusinesses,
      deadLetters: deadLetters.map((event) => ({ id: event._id, businessId: event.businessId, businessName: names.get(event.businessId) ?? "Unknown business", attempts: event.attempts, errorCode: event.errorCode ?? null, receivedAt: event.receivedAt, dueAt: event.dueAt })),
      failedWebhooks: failedWebhooks.map((event) => ({ id: event._id, businessId: event.businessId ?? null, businessName: event.businessId ? names.get(event.businessId) ?? "Unknown business" : "Unmatched event", eventType: event.eventType, code: event.code ?? null, receivedAt: event.receivedAt })),
    };
  },
});

export const billing = query({
  args: { rangeDays: v.number() },
  returns: v.object({
    summary: v.object({ mrrKobo: v.number(), active: v.number(), trialing: v.number(), pastDue: v.number(), cancelling: v.number(), grossKobo: v.number(), netKobo: v.number() }),
    planMix: v.array(v.object({ plan: v.string(), subscriptions: v.number(), mrrKobo: v.number() })),
    recentPayments: v.array(v.object({ id: v.id("billingPayments"), businessId: v.id("businesses"), businessName: v.string(), amountKobo: v.number(), status: v.string(), channel: v.union(v.string(), v.null()), paidAt: v.number() })),
    attention: v.array(v.object({ id: v.id("businessSubscriptions"), businessId: v.id("businesses"), businessName: v.string(), plan: v.string(), status: subscriptionStatus, amountKobo: v.number(), periodEnd: v.union(v.number(), v.null()) })),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rangeDays = Math.min(90, Math.max(7, Math.floor(args.rangeDays)));
    const since = Date.now() - rangeDays * 86_400_000;
    const [subscriptionGroups, successful, failed, refunded] = await Promise.all([
      Promise.all(subscriptionStatuses.map((status) => subscriptionsByStatus(ctx, status))),
      ctx.db.query("billingPayments").withIndex("by_status_created", (builder) => builder.eq("status", "success").gte("createdAt", since)).order("desc").take(BUSINESS_LIMIT),
      ctx.db.query("billingPayments").withIndex("by_status_created", (builder) => builder.eq("status", "failed").gte("createdAt", since)).order("desc").take(100),
      ctx.db.query("billingPayments").withIndex("by_status_created", (builder) => builder.eq("status", "refunded").gte("createdAt", since)).order("desc").take(100),
    ]);
    const subscriptions = subscriptionGroups.flat();
    const businessIds = new Set<Id<"businesses">>();
    for (const payment of [...successful.slice(0, 40), ...failed.slice(0, 20), ...refunded.slice(0, 20)]) businessIds.add(payment.businessId);
    for (const subscription of [...subscriptionGroups[2], ...subscriptionGroups[3]]) businessIds.add(subscription.businessId);
    const names = new Map<Id<"businesses">, string>();
    await Promise.all([...businessIds].map(async (id) => {
      const business = await ctx.db.get(id);
      names.set(id, business?.name ?? "Deleted business");
    }));
    const allPayments = [...successful, ...failed, ...refunded].sort((a, b) => (b.paidAt ?? b.createdAt) - (a.paidAt ?? a.createdAt)).slice(0, 50);
    const planMix = new Map<string, { subscriptions: number; mrrKobo: number }>();
    for (const subscription of subscriptions) {
      const current = planMix.get(subscription.plan) ?? { subscriptions: 0, mrrKobo: 0 };
      planMix.set(subscription.plan, { subscriptions: current.subscriptions + 1, mrrKobo: current.mrrKobo + planMrr(subscription) });
    }
    const grossKobo = successful.reduce((sum, payment) => sum + payment.amountKobo, 0);
    const refundedKobo = refunded.reduce((sum, payment) => sum + payment.amountKobo, 0);
    return {
      summary: { mrrKobo: subscriptions.reduce((sum, subscription) => sum + planMrr(subscription), 0), active: subscriptionGroups[1].length, trialing: subscriptionGroups[0].length, pastDue: subscriptionGroups[2].length, cancelling: subscriptionGroups[3].length, grossKobo, netKobo: grossKobo - refundedKobo },
      planMix: [...planMix.entries()].map(([plan, value]) => ({ plan, ...value })).sort((a, b) => b.mrrKobo - a.mrrKobo),
      recentPayments: allPayments.map((payment) => ({ id: payment._id, businessId: payment.businessId, businessName: names.get(payment.businessId) ?? "Unknown business", amountKobo: payment.amountKobo, status: payment.status, channel: payment.channel ?? null, paidAt: payment.paidAt ?? payment.createdAt })),
      attention: [...subscriptionGroups[2], ...subscriptionGroups[3]].sort((a, b) => (a.currentPeriodEnd ?? Infinity) - (b.currentPeriodEnd ?? Infinity)).slice(0, 40).map((subscription) => ({ id: subscription._id, businessId: subscription.businessId, businessName: names.get(subscription.businessId) ?? "Unknown business", plan: subscription.plan, status: subscription.status, amountKobo: subscription.amountKobo, periodEnd: subscription.currentPeriodEnd ?? null })),
    };
  },
});

export const deletionStatus = query({
  args: { businessId: v.id("businesses") },
  returns: v.union(v.null(), v.object({
    jobId: v.id("adminAccountDeletionJobs"),
    state: v.union(v.literal("pending"), v.literal("running"), v.literal("done"), v.literal("dead_letter")),
    phase: v.number(),
    deletedRecords: v.number(),
    requestedAt: v.number(),
    completedAt: v.union(v.number(), v.null()),
    errorCode: v.union(v.string(), v.null()),
  })),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const job = await ctx.db.query("adminAccountDeletionJobs").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).unique();
    return job ? { jobId: job._id, state: job.state, phase: job.phase, deletedRecords: job.deletedRecords, requestedAt: job.requestedAt, completedAt: job.completedAt ?? null, errorCode: job.errorCode ?? null } : null;
  },
});

export const requestAccountDeletion = action({
  args: { businessId: v.id("businesses"), confirmation: v.string() },
  returns: v.id("adminAccountDeletionJobs"),
  handler: async (ctx, args): Promise<Id<"adminAccountDeletionJobs">> => {
    const identity = await requireAdmin(ctx);
    const preparation = await ctx.runQuery(internal.adminDeletion.accountDeletionPreparation, { businessId: args.businessId });
    if (!preparation) throw new ConvexError({ code: "BUSINESS_NOT_FOUND" });
    if (args.confirmation !== preparation.businessName) throw new ConvexError({ code: "DELETION_CONFIRMATION_MISMATCH" });
    if (preparation.subscriptionStatus && ["active", "past_due", "cancel_at_period_end"].includes(preparation.subscriptionStatus)) {
      if (!preparation.subscriptionCode || !preparation.emailTokenCiphertext) throw new ConvexError({ code: "BILLING_PROVIDER_SYNC_PENDING" });
      const emailToken = await decryptSecret(preparation.emailTokenCiphertext, `billing:${preparation.businessId}:paystack-email-token`);
      await paystackRequest("/subscription/disable", { method: "POST", body: { code: preparation.subscriptionCode, token: emailToken } });
    }
    return await ctx.runMutation(internal.adminDeletion.beginAccountDeletion, { businessId: args.businessId, requestedBy: identity.subject });
  },
});
