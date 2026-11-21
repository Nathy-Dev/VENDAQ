import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { annualUsageWindow, BILLING_PLANS, TRIAL_ASSISTED_CONVERSATIONS, monthWindow, type BillingPlan } from "./billingPlans";

type DbCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export type BillingAccess = {
  plan: BillingPlan | "trial" | "none";
  status: string;
  canUsePaidFeatures: boolean;
  readOnly: boolean;
  assistedConversationLimit: number;
  assistedConversationsUsed: number;
  enabledGroupLimit: number;
  automation: boolean;
  periodStart: number;
  periodEnd: number;
  trialEndsAt: number | null;
  graceEndsAt: number | null;
};

function usageWindow(subscription: Doc<"businessSubscriptions"> | null, now: number) {
  // Annual billing still includes a monthly conversation allowance, reset on
  // the purchase-day anniversary rather than granting one quota for the year.
  if (subscription?.billingInterval === "annual" && subscription.currentPeriodStart) return annualUsageWindow(subscription.currentPeriodStart, now);
  if (subscription?.currentPeriodStart && subscription.currentPeriodEnd && subscription.currentPeriodEnd > subscription.currentPeriodStart) {
    return { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd };
  }
  return monthWindow(now);
}

export async function billingAccess(ctx: DbCtx, business: Doc<"businesses">, now = Date.now()): Promise<BillingAccess> {
  const subscription = await ctx.db.query("businessSubscriptions").withIndex("by_business", (q) => q.eq("businessId", business._id)).unique();
  const window = usageWindow(subscription, now);
  const usage = await ctx.db.query("billingUsagePeriods").withIndex("by_business_metric_period", (q) => q.eq("businessId", business._id).eq("metric", "assisted_conversation").eq("periodStart", window.start)).unique();
  const used = usage?.quantity ?? 0;
  if (!subscription) return { plan: "none", status: "inactive", canUsePaidFeatures: false, readOnly: true, assistedConversationLimit: 0, assistedConversationsUsed: used, enabledGroupLimit: 0, automation: false, periodStart: window.start, periodEnd: window.end, trialEndsAt: null, graceEndsAt: null };

  const trialActive = subscription.status === "trialing" && (subscription.trialEndsAt ?? 0) > now;
  const paidActive = ["active", "cancel_at_period_end"].includes(subscription.status) && (subscription.currentPeriodEnd ?? Number.MAX_SAFE_INTEGER) > now;
  const inGrace = subscription.status === "past_due" && (subscription.graceEndsAt ?? 0) > now;
  const entitlement = BILLING_PLANS[subscription.plan];
  const limit = trialActive ? TRIAL_ASSISTED_CONVERSATIONS : entitlement.assistedConversationLimit;
  const accountActive = trialActive || paidActive || inGrace;
  const canUsePaidFeatures = accountActive && used < limit;
  return {
    plan: trialActive ? "trial" : subscription.plan,
    status: subscription.status,
    canUsePaidFeatures,
    readOnly: !accountActive,
    assistedConversationLimit: limit,
    assistedConversationsUsed: used,
    enabledGroupLimit: trialActive ? BILLING_PLANS.growth.enabledGroupLimit : entitlement.enabledGroupLimit,
    automation: trialActive ? true : entitlement.automation,
    periodStart: window.start,
    periodEnd: window.end,
    trialEndsAt: subscription.trialEndsAt ?? null,
    graceEndsAt: subscription.graceEndsAt ?? null,
  };
}

export async function reserveAssistedConversation(ctx: MutationCtx, args: { business: Doc<"businesses">; conversationId: Id<"conversations">; now?: number }): Promise<boolean> {
  const now = args.now ?? Date.now();
  const access = await billingAccess(ctx, args.business, now);
  if (!access.canUsePaidFeatures) return false;
  const existing = await ctx.db.query("billingUsageConversations").withIndex("by_business_period_conversation", (q) => q.eq("businessId", args.business._id).eq("periodStart", access.periodStart).eq("conversationId", args.conversationId)).unique();
  if (existing) return true;
  if (access.assistedConversationsUsed >= access.assistedConversationLimit) return false;
  const usage = await ctx.db.query("billingUsagePeriods").withIndex("by_business_metric_period", (q) => q.eq("businessId", args.business._id).eq("metric", "assisted_conversation").eq("periodStart", access.periodStart)).unique();
  await ctx.db.insert("billingUsageConversations", { businessId: args.business._id, conversationId: args.conversationId, periodStart: access.periodStart, firstAssistedAt: now });
  if (usage) await ctx.db.patch(usage._id, { quantity: usage.quantity + 1, updatedAt: now });
  else await ctx.db.insert("billingUsagePeriods", { businessId: args.business._id, periodStart: access.periodStart, periodEnd: access.periodEnd, metric: "assisted_conversation", quantity: 1, updatedAt: now });
  return true;
}
