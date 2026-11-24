import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireIdentity } from "./lib/authorization";
import { billingAccess } from "./lib/billingAccess";
import { amountFor, PAYMENT_GRACE_DAYS, periodEndFrom, planCodeFor, siteUrl } from "./lib/billingPlans";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { paystackRequest, paystackTimestamp, safeProviderString, type ProviderObject } from "./lib/paystack";
import { hasCurrentLegalAcceptance } from "./lib/compliance";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const purchasablePlan = v.union(v.literal("starter"), v.literal("growth"));
const billingInterval = v.union(v.literal("monthly"), v.literal("annual"));
const checkoutState = v.union(v.literal("initializing"), v.literal("pending"), v.literal("completed"), v.literal("failed"), v.literal("expired"));

function cleanEmail(identity: { email?: string }): string {
  const email = identity.email?.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ConvexError({ code: "BILLING_EMAIL_REQUIRED" });
  return email;
}

function providerObject(value: unknown): ProviderObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ProviderObject : {};
}

function transactionFacts(data: ProviderObject) {
  const customer = providerObject(data.customer);
  const subscription = providerObject(data.subscription);
  const plan = providerObject(data.plan);
  return {
    reference: safeProviderString(data.reference, 120),
    status: safeProviderString(data.status, 40),
    amountKobo: typeof data.amount === "number" ? data.amount : undefined,
    currency: safeProviderString(data.currency, 8),
    transactionId: data.id === undefined ? undefined : String(data.id).slice(0, 120),
    channel: safeProviderString(data.channel, 40),
    paidAt: paystackTimestamp(data.paid_at ?? data.paidAt) ?? Date.now(),
    providerPlanCode: safeProviderString(plan.plan_code ?? data.plan, 120),
    providerCustomerCode: safeProviderString(customer.customer_code ?? customer.code, 120),
    providerSubscriptionCode: safeProviderString(subscription.subscription_code ?? data.subscription_code, 120),
    providerEmailToken: safeProviderString(subscription.email_token ?? data.email_token, 500),
  };
}

export const overview = query({
  args: { now: v.number() },
  returns: v.union(v.null(), v.object({
    businessId: v.id("businesses"), plan: v.string(), status: v.string(), billingInterval: v.union(billingInterval, v.null()), amountKobo: v.number(),
    readOnly: v.boolean(), canUsePaidFeatures: v.boolean(), automation: v.boolean(), assistedConversationsUsed: v.number(), assistedConversationLimit: v.number(),
    enabledGroupLimit: v.number(), currentPeriodEnd: v.union(v.number(), v.null()), trialEndsAt: v.union(v.number(), v.null()), graceEndsAt: v.union(v.number(), v.null()),
    cancelAtPeriodEnd: v.boolean(), canCancel: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const business = await ctx.db.query("businesses").withIndex("by_owner", (q) => q.eq("ownerId", identity.subject)).unique();
    if (!business || business.foundationVersion !== 1) return null;
    const subscription = await ctx.db.query("businessSubscriptions").withIndex("by_business", (q) => q.eq("businessId", business._id)).unique();
    // This timestamp only controls the reactive display. All mutations,
    // dispatches, quotas, and sweeps independently use trusted server time.
    const displayNow = Number.isFinite(args.now) && args.now > 0 ? args.now : 0;
    const access = await billingAccess(ctx, business, displayNow);
    return {
      businessId: business._id, plan: access.plan, status: access.status, billingInterval: subscription?.billingInterval ?? null, amountKobo: subscription?.amountKobo ?? 0,
      readOnly: access.readOnly, canUsePaidFeatures: access.canUsePaidFeatures, automation: access.automation, assistedConversationsUsed: access.assistedConversationsUsed,
      assistedConversationLimit: access.assistedConversationLimit, enabledGroupLimit: access.enabledGroupLimit, currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      trialEndsAt: access.trialEndsAt, graceEndsAt: access.graceEndsAt, cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      canCancel: !!subscription?.providerSubscriptionCode && !!subscription.providerEmailTokenCiphertext && ["active", "past_due", "cancel_at_period_end"].includes(subscription.status),
    };
  },
});

export const prepareCheckout = internalMutation({
  args: { ownerId: v.string(), reference: v.string(), plan: purchasablePlan, billingInterval, providerPlanCode: v.string(), amountKobo: v.number() },
  returns: v.id("billingCheckoutIntents"),
  handler: async (ctx, args) => {
    const business = await ctx.db.query("businesses").withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId)).unique();
    if (!business || business.foundationVersion !== 1) throw new ConvexError({ code: "BUSINESS_REQUIRED" });
    const current = await ctx.db.query("businessSubscriptions").withIndex("by_business", (q) => q.eq("businessId", business._id)).unique();
    if (current && current.amountKobo > 0 && ["active", "past_due", "cancel_at_period_end"].includes(current.status)) throw new ConvexError({ code: "PLAN_CHANGE_REQUIRES_SUPPORT" });
    const existingReference = await ctx.db.query("billingCheckoutIntents").withIndex("by_reference", (q) => q.eq("reference", args.reference)).unique();
    if (existingReference) return existingReference._id;
    const now = Date.now();
    return await ctx.db.insert("billingCheckoutIntents", { businessId: business._id, ownerId: args.ownerId, reference: args.reference, plan: args.plan, billingInterval: args.billingInterval, providerPlanCode: args.providerPlanCode, amountKobo: args.amountKobo, currency: "NGN", state: "initializing", createdAt: now, expiresAt: now + 30 * 60_000 });
  },
});

export const updateCheckout = internalMutation({
  args: { reference: v.string(), state: checkoutState, accessCode: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.query("billingCheckoutIntents").withIndex("by_reference", (q) => q.eq("reference", args.reference)).unique();
    if (intent && intent.state !== "completed") await ctx.db.patch(intent._id, { state: args.state, ...(args.accessCode ? { accessCode: args.accessCode } : {}) });
    return null;
  },
});

export const checkoutForOwner = internalQuery({
  args: { ownerId: v.string(), reference: v.string() },
  returns: v.union(v.null(), v.object({ businessId: v.id("businesses"), plan: purchasablePlan, billingInterval, providerPlanCode: v.string(), amountKobo: v.number(), state: checkoutState, expiresAt: v.number() })),
  handler: async (ctx, args) => {
    const intent = await ctx.db.query("billingCheckoutIntents").withIndex("by_reference", (q) => q.eq("reference", args.reference)).unique();
    return intent && intent.ownerId === args.ownerId ? { businessId: intent.businessId, plan: intent.plan, billingInterval: intent.billingInterval, providerPlanCode: intent.providerPlanCode, amountKobo: intent.amountKobo, state: intent.state, expiresAt: intent.expiresAt } : null;
  },
});

export const checkoutLegalAccepted = internalQuery({
  args: { ownerId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => await hasCurrentLegalAcceptance(ctx, args.ownerId, "billing"),
});

export const accessForOwner = internalQuery({
  args: { ownerId: v.string() },
  returns: v.union(v.null(), v.object({ canUsePaidFeatures: v.boolean(), automation: v.boolean() })),
  handler: async (ctx, args) => {
    const business = await ctx.db.query("businesses").withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId)).unique();
    if (!business || business.foundationVersion !== 1) return null;
    const access = await billingAccess(ctx, business);
    return { canUsePaidFeatures: access.canUsePaidFeatures, automation: access.automation };
  },
});

async function applySuccessfulPayment(ctx: MutationCtx, intent: Doc<"billingCheckoutIntents">, facts: { reference: string; amountKobo: number; currency: string; transactionId?: string; channel?: string; paidAt: number; providerPlanCode?: string; providerCustomerCode?: string; providerSubscriptionCode?: string; providerEmailToken?: string }) {
  if (facts.amountKobo !== intent.amountKobo || facts.currency !== "NGN" || (facts.providerPlanCode && facts.providerPlanCode !== intent.providerPlanCode)) throw new Error("BILLING_PAYMENT_MISMATCH");
  const existingPayment = await ctx.db.query("billingPayments").withIndex("by_provider_reference", (q) => q.eq("provider", "paystack").eq("reference", facts.reference)).unique();
  if (!existingPayment) await ctx.db.insert("billingPayments", { businessId: intent.businessId, provider: "paystack", reference: facts.reference, providerTransactionId: facts.transactionId, amountKobo: facts.amountKobo, currency: "NGN", status: "success", channel: facts.channel, paidAt: facts.paidAt, createdAt: Date.now() });
  const existing = await ctx.db.query("businessSubscriptions").withIndex("by_business", (q) => q.eq("businessId", intent.businessId)).unique();
  const periodStart = facts.paidAt;
  const emailTokenCiphertext = facts.providerEmailToken ? await encryptSecret(facts.providerEmailToken, `billing:${intent.businessId}:paystack-email-token`) : undefined;
  const patch = { provider: "paystack" as const, plan: intent.plan, billingInterval: intent.billingInterval, status: "active" as const, providerPlanCode: intent.providerPlanCode, providerCustomerCode: facts.providerCustomerCode ?? existing?.providerCustomerCode, providerSubscriptionCode: facts.providerSubscriptionCode ?? existing?.providerSubscriptionCode, providerEmailTokenCiphertext: emailTokenCiphertext ?? existing?.providerEmailTokenCiphertext, currency: "NGN" as const, amountKobo: intent.amountKobo, currentPeriodStart: periodStart, currentPeriodEnd: periodEndFrom(periodStart, intent.billingInterval), graceEndsAt: undefined, cancelAtPeriodEnd: false, cancelledAt: undefined, lastPaymentAt: facts.paidAt, updatedAt: Date.now() };
  if (existing) await ctx.db.patch(existing._id, patch);
  else await ctx.db.insert("businessSubscriptions", { businessId: intent.businessId, ...patch, createdAt: Date.now() });
  await ctx.db.patch(intent._id, { state: "completed", completedAt: Date.now() });
}

export const reconcileVerifiedPayment = internalMutation({
  args: { reference: v.string(), amountKobo: v.number(), currency: v.string(), transactionId: v.optional(v.string()), channel: v.optional(v.string()), paidAt: v.number(), providerPlanCode: v.optional(v.string()), providerCustomerCode: v.optional(v.string()), providerSubscriptionCode: v.optional(v.string()), providerEmailToken: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.query("billingCheckoutIntents").withIndex("by_reference", (q) => q.eq("reference", args.reference)).unique();
    if (!intent || intent.expiresAt <= Date.now() && intent.state !== "completed") return false;
    await applySuccessfulPayment(ctx, intent, args);
    return true;
  },
});

export const createCheckout = action({
  args: { plan: purchasablePlan, billingInterval },
  returns: v.object({ reference: v.string(), authorizationUrl: v.string() }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    if (!await ctx.runQuery(internal.billing.checkoutLegalAccepted, { ownerId: identity.subject })) {
      throw new ConvexError({ code: "LEGAL_ACCEPTANCE_REQUIRED", document: "billing" });
    }
    const email = cleanEmail(identity);
    const reference = `px_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll("-", "")}`;
    const providerPlanCode = planCodeFor(args.plan, args.billingInterval);
    const amountKobo = amountFor(args.plan, args.billingInterval);
    await ctx.runMutation(internal.billing.prepareCheckout, { ownerId: identity.subject, reference, plan: args.plan, billingInterval: args.billingInterval, providerPlanCode, amountKobo });
    try {
      const payload = await paystackRequest("/transaction/initialize", { method: "POST", body: { email, amount: amountKobo, currency: "NGN", plan: providerPlanCode, reference, callback_url: `${siteUrl()}/billing?reference=${encodeURIComponent(reference)}`, metadata: { product: "pipelixr", checkout_reference: reference } } });
      const providerData = providerObject(payload.data);
      const authorizationUrl = safeProviderString(providerData.authorization_url, 2_000);
      const accessCode = safeProviderString(providerData.access_code, 200);
      if (!authorizationUrl) throw new Error("PAYSTACK_INVALID_RESPONSE");
      await ctx.runMutation(internal.billing.updateCheckout, { reference, state: "pending", ...(accessCode ? { accessCode } : {}) });
      return { reference, authorizationUrl };
    } catch (error) {
      await ctx.runMutation(internal.billing.updateCheckout, { reference, state: "failed" });
      throw error;
    }
  },
});

export const verifyCheckout = action({
  args: { reference: v.string() },
  returns: v.object({ active: v.boolean() }),
  handler: async (ctx, args): Promise<{ active: boolean }> => {
    const identity = await requireIdentity(ctx);
    if (!/^px_[A-Za-z0-9_]+$/.test(args.reference)) throw new ConvexError({ code: "INVALID_REFERENCE" });
    const intent = await ctx.runQuery(internal.billing.checkoutForOwner, { ownerId: identity.subject, reference: args.reference });
    if (!intent) throw new ConvexError({ code: "CHECKOUT_NOT_FOUND" });
    if (intent.state === "completed") return { active: true };
    const payload = await paystackRequest(`/transaction/verify/${encodeURIComponent(args.reference)}`);
    const facts = transactionFacts(providerObject(payload.data));
    if (facts.status !== "success" || facts.reference !== args.reference || facts.amountKobo === undefined || !facts.currency) return { active: false };
    const active: boolean = await ctx.runMutation(internal.billing.reconcileVerifiedPayment, { reference: args.reference, amountKobo: facts.amountKobo, currency: facts.currency, paidAt: facts.paidAt, ...(facts.transactionId ? { transactionId: facts.transactionId } : {}), ...(facts.channel ? { channel: facts.channel } : {}), ...(facts.providerPlanCode ? { providerPlanCode: facts.providerPlanCode } : {}), ...(facts.providerCustomerCode ? { providerCustomerCode: facts.providerCustomerCode } : {}), ...(facts.providerSubscriptionCode ? { providerSubscriptionCode: facts.providerSubscriptionCode } : {}), ...(facts.providerEmailToken ? { providerEmailToken: facts.providerEmailToken } : {}) });
    return { active };
  },
});

export const cancellationDetails = internalQuery({
  args: { ownerId: v.string() },
  returns: v.union(v.null(), v.object({ subscriptionId: v.id("businessSubscriptions"), businessId: v.id("businesses"), subscriptionCode: v.string(), emailTokenCiphertext: v.string() })),
  handler: async (ctx, args) => {
    const business = await ctx.db.query("businesses").withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId)).unique();
    if (!business) return null;
    const subscription = await ctx.db.query("businessSubscriptions").withIndex("by_business", (q) => q.eq("businessId", business._id)).unique();
    return subscription?.providerSubscriptionCode && subscription.providerEmailTokenCiphertext ? { subscriptionId: subscription._id, businessId: business._id, subscriptionCode: subscription.providerSubscriptionCode, emailTokenCiphertext: subscription.providerEmailTokenCiphertext } : null;
  },
});

export const markCancellation = internalMutation({
  args: { subscriptionId: v.id("businessSubscriptions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subscription = await ctx.db.get(args.subscriptionId);
    if (subscription) await ctx.db.patch(subscription._id, { status: "cancel_at_period_end", cancelAtPeriodEnd: true, cancelledAt: Date.now(), updatedAt: Date.now() });
    return null;
  },
});

export const cancelSubscription = action({
  args: {},
  returns: v.object({ cancelAtPeriodEnd: v.boolean() }),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const details = await ctx.runQuery(internal.billing.cancellationDetails, { ownerId: identity.subject });
    if (!details) throw new ConvexError({ code: "BILLING_PROVIDER_SYNC_PENDING" });
    const emailToken = await decryptSecret(details.emailTokenCiphertext, `billing:${details.businessId}:paystack-email-token`);
    await paystackRequest("/subscription/disable", { method: "POST", body: { code: details.subscriptionCode, token: emailToken } });
    await ctx.runMutation(internal.billing.markCancellation, { subscriptionId: details.subscriptionId });
    return { cancelAtPeriodEnd: true };
  },
});

export const processWebhook = internalMutation({
  args: { eventDigest: v.string(), eventType: v.string(), reference: v.optional(v.string()), status: v.optional(v.string()), amountKobo: v.optional(v.number()), currency: v.optional(v.string()), transactionId: v.optional(v.string()), channel: v.optional(v.string()), paidAt: v.optional(v.number()), providerPlanCode: v.optional(v.string()), providerCustomerCode: v.optional(v.string()), providerSubscriptionCode: v.optional(v.string()), providerEmailToken: v.optional(v.string()), nextPaymentAt: v.optional(v.number()) },
  returns: v.object({ processed: v.boolean() }),
  handler: async (ctx, args) => {
    const duplicate = await ctx.db.query("billingWebhookEvents").withIndex("by_provider_digest", (q) => q.eq("provider", "paystack").eq("eventDigest", args.eventDigest)).unique();
    if (duplicate) return { processed: duplicate.state === "processed" };
    const now = Date.now();
    const intent = args.reference ? await ctx.db.query("billingCheckoutIntents").withIndex("by_reference", (q) => q.eq("reference", args.reference!)).unique() : null;
    let subscription = args.providerSubscriptionCode ? await ctx.db.query("businessSubscriptions").withIndex("by_provider_subscription", (q) => q.eq("provider", "paystack").eq("providerSubscriptionCode", args.providerSubscriptionCode)).unique() : null;
    if (!subscription && args.providerCustomerCode) subscription = await ctx.db.query("businessSubscriptions").withIndex("by_provider_customer", (q) => q.eq("provider", "paystack").eq("providerCustomerCode", args.providerCustomerCode)).unique();
    if (!subscription && intent) subscription = await ctx.db.query("businessSubscriptions").withIndex("by_business", (q) => q.eq("businessId", intent!.businessId)).unique();
    let processed = false;
    try {
      if (args.eventType === "charge.success" && intent && args.reference && args.amountKobo !== undefined && args.currency && args.paidAt) {
        await applySuccessfulPayment(ctx, intent, { reference: args.reference, amountKobo: args.amountKobo, currency: args.currency, paidAt: args.paidAt, transactionId: args.transactionId, channel: args.channel, providerPlanCode: args.providerPlanCode, providerCustomerCode: args.providerCustomerCode, providerSubscriptionCode: args.providerSubscriptionCode, providerEmailToken: args.providerEmailToken });
        processed = true;
      } else if (args.eventType === "charge.success" && subscription && args.reference && args.amountKobo === subscription.amountKobo && args.currency === "NGN" && args.paidAt) {
        const payment = await ctx.db.query("billingPayments").withIndex("by_provider_reference", (q) => q.eq("provider", "paystack").eq("reference", args.reference!)).unique();
        if (!payment) await ctx.db.insert("billingPayments", { businessId: subscription.businessId, provider: "paystack", reference: args.reference, providerTransactionId: args.transactionId, amountKobo: args.amountKobo, currency: "NGN", status: "success", channel: args.channel, paidAt: args.paidAt, createdAt: now });
        const start = subscription.currentPeriodEnd && subscription.currentPeriodEnd > args.paidAt - 3 * 86_400_000 ? subscription.currentPeriodEnd : args.paidAt;
        await ctx.db.patch(subscription._id, { status: "active", currentPeriodStart: start, currentPeriodEnd: periodEndFrom(start, subscription.billingInterval), graceEndsAt: undefined, cancelAtPeriodEnd: false, lastPaymentAt: args.paidAt, providerCustomerCode: args.providerCustomerCode ?? subscription.providerCustomerCode, providerSubscriptionCode: args.providerSubscriptionCode ?? subscription.providerSubscriptionCode, ...(args.providerEmailToken ? { providerEmailTokenCiphertext: await encryptSecret(args.providerEmailToken, `billing:${subscription.businessId}:paystack-email-token`) } : {}), updatedAt: now });
        processed = true;
      } else if ((args.eventType === "subscription.create" || args.eventType === "subscription.enable") && subscription) {
        await ctx.db.patch(subscription._id, { status: "active", providerCustomerCode: args.providerCustomerCode ?? subscription.providerCustomerCode, providerSubscriptionCode: args.providerSubscriptionCode ?? subscription.providerSubscriptionCode, ...(args.providerEmailToken ? { providerEmailTokenCiphertext: await encryptSecret(args.providerEmailToken, `billing:${subscription.businessId}:paystack-email-token`) } : {}), ...(args.nextPaymentAt ? { currentPeriodEnd: args.nextPaymentAt } : {}), cancelAtPeriodEnd: false, updatedAt: now });
        processed = true;
      } else if ((args.eventType === "invoice.payment_failed" || args.eventType === "charge.failed") && subscription && ["active", "past_due", "cancel_at_period_end"].includes(subscription.status)) {
        const graceEndsAt = subscription.status === "past_due" && subscription.graceEndsAt
          ? subscription.graceEndsAt
          : now + PAYMENT_GRACE_DAYS * 86_400_000;
        await ctx.db.patch(subscription._id, { status: "past_due", graceEndsAt, updatedAt: now });
        processed = true;
      } else if ((args.eventType === "subscription.disable" || args.eventType === "subscription.not_renew") && subscription) {
        await ctx.db.patch(subscription._id, { status: (subscription.currentPeriodEnd ?? 0) > now ? "cancel_at_period_end" : "cancelled", cancelAtPeriodEnd: true, cancelledAt: now, updatedAt: now });
        processed = true;
      }
      await ctx.db.insert("billingWebhookEvents", { provider: "paystack", eventDigest: args.eventDigest, eventType: args.eventType.slice(0, 120), state: processed ? "processed" : "ignored", receivedAt: now, processedAt: Date.now(), businessId: intent?.businessId ?? subscription?.businessId, reference: args.reference });
      return { processed };
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 120) : "PROCESSING_FAILED";
      // A verified but commercially invalid charge will never become valid on
      // provider retry. Persist the rejection and acknowledge it once. Other
      // failures roll back so Paystack receives a non-2xx and retries later.
      if (code === "BILLING_PAYMENT_MISMATCH") {
        await ctx.db.insert("billingWebhookEvents", { provider: "paystack", eventDigest: args.eventDigest, eventType: args.eventType.slice(0, 120), state: "failed", receivedAt: now, processedAt: Date.now(), businessId: intent?.businessId ?? subscription?.businessId, reference: args.reference, code });
        return { processed: false };
      }
      throw error;
    }
  },
});

export const sweep = internalMutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    for (const status of ["trialing", "active", "cancel_at_period_end", "past_due"] as const) {
      const expired = await ctx.db.query("businessSubscriptions").withIndex("by_status_period_end", (q) => q.eq("status", status).lte("currentPeriodEnd", now)).take(100);
      for (const subscription of expired) {
        if (subscription.status === "past_due" && (subscription.graceEndsAt ?? 0) > now) continue;
        const nextStatus = subscription.cancelAtPeriodEnd ? "cancelled" : "expired";
        await ctx.db.patch(subscription._id, { status: nextStatus, updatedAt: now });
        const business = await ctx.db.get(subscription.businessId);
        if (business) await ctx.db.patch(business._id, { killSwitch: true, aiEnabled: false, customerAutoReplyEnabled: false, groupAutoReplyEnabled: false });
      }
    }
    const checkoutIntents = await ctx.db.query("billingCheckoutIntents").withIndex("by_state_expiry", (q) => q.eq("state", "pending").lte("expiresAt", now)).take(100);
    for (const intent of checkoutIntents) await ctx.db.patch(intent._id, { state: "expired" });
    return null;
  },
});
