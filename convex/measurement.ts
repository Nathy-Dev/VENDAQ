import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireBusiness } from "./lib/authorization";
import { foundationPolicy } from "./lib/policy";

const metricValidator = v.object({
  leadsCaptured: v.number(),
  buyersRepliedAfterFollowUp: v.number(),
  manualFollowUpClaims: v.number(),
  missedOpportunities: v.number(),
  orders: v.number(),
  paidOrders: v.number(),
  claimedRecoveredRevenue: v.number(),
  confirmedRecoveredRevenue: v.number(),
  recordLimit: v.number(),
  mayBeTruncated: v.boolean(),
});

export const dashboard = query({
  args: { businessId: v.id("businesses") },
  returns: metricValidator,
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const limit = foundationPolicy().dashboardRecordLimit;
    const [customers, interactions, claims, missed, orders, attributions] = await Promise.all([
      ctx.db.query("customers").withIndex("by_business_last_interaction", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(limit),
      ctx.db.query("interactions").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).take(limit),
      ctx.db.query("sellerActionEvents").withIndex("by_business_time", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(limit),
      ctx.db.query("missedRevenueOpportunities").withIndex("by_business_state_due", (builder) => builder.eq("businessId", args.businessId).eq("state", "missed")).take(limit),
      ctx.db.query("orders").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(limit),
      ctx.db.query("revenueAttributions").withIndex("by_business_time", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(limit),
    ]);

    const manualClaims = claims.filter((event) => event.type === "manual_send_claim");
    const claimTimeByCustomer = new Map<Id<"customers">, number>();
    for (const claim of manualClaims) {
      const current = claimTimeByCustomer.get(claim.customerId);
      if (current === undefined || claim.at < current) claimTimeByCustomer.set(claim.customerId, claim.at);
    }
    const repliedCustomers = new Set<Id<"customers">>();
    for (const interaction of interactions) {
      const claimedAt = claimTimeByCustomer.get(interaction.customerId);
      if (interaction.role === "customer" && claimedAt !== undefined && interaction.timestamp > claimedAt) repliedCustomers.add(interaction.customerId);
    }

    return {
      leadsCaptured: customers.filter((customer) => customer.deletedAt === undefined).length,
      buyersRepliedAfterFollowUp: repliedCustomers.size,
      manualFollowUpClaims: manualClaims.length,
      missedOpportunities: missed.length,
      orders: orders.length,
      paidOrders: orders.filter((order) => order.status === "paid").length,
      claimedRecoveredRevenue: attributions.filter((entry) => entry.state === "claimed").reduce((sum, entry) => sum + entry.claimedValue, 0),
      confirmedRecoveredRevenue: attributions.filter((entry) => entry.state === "claimed").reduce((sum, entry) => sum + entry.confirmedValue, 0),
      recordLimit: limit,
      mayBeTruncated: [customers, interactions, claims, missed, orders, attributions].some((records) => records.length === limit),
    };
  },
});

export const attributionAudit = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({
    attributionId: v.id("revenueAttributions"),
    customerId: v.id("customers"),
    taskId: v.id("followUpTasks"),
    orderId: v.id("orders"),
    state: v.union(v.literal("claimed"), v.literal("rejected"), v.literal("reversed")),
    claimedValue: v.number(),
    confirmedValue: v.number(),
    manualSentAt: v.number(),
    orderWonAt: v.number(),
    windowDays: v.number(),
    reason: v.string(),
  })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const entries = await ctx.db.query("revenueAttributions").withIndex("by_business_time", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(100);
    return entries.map((entry) => ({ attributionId: entry._id, customerId: entry.customerId, taskId: entry.taskId, orderId: entry.orderId, state: entry.state, claimedValue: entry.claimedValue, confirmedValue: entry.confirmedValue, manualSentAt: entry.manualSentAt, orderWonAt: entry.orderWonAt, windowDays: entry.windowDays, reason: entry.reason }));
  },
});
