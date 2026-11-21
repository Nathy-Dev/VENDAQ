import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { api, internal } from "../convex/_generated/api";
import { createHarness, tenant } from "./harness";
import { annualUsageWindow, BILLING_PLANS, PAYMENT_GRACE_DAYS, TRIAL_ASSISTED_CONVERSATIONS, periodEndFrom } from "../convex/lib/billingPlans";
import { billingAccess, reserveAssistedConversation } from "../convex/lib/billingAccess";

async function conversation(harness: ReturnType<typeof createHarness>, businessId: any, suffix: string) {
  return await harness.run(async (ctx) => {
    const now = Date.now();
    const customerId = await ctx.db.insert("customers", { businessId, phone: `2348000${suffix}@s.whatsapp.net`, identityKey: `billing-${suffix}`, totalValue: 0, lastInteraction: now, tags: [] });
    return await ctx.db.insert("conversations", { businessId, customerId, identityKey: `billing-${suffix}`, revision: 1, lastEventAt: now, messageCount: 1 });
  });
}

describe("production billing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
    process.env.AUTH_JWT_ISSUER = "https://auth.example.test";
    process.env.SESSION_ENCRYPTION_KEY_VERSION = "v1";
    process.env.SESSION_ENCRYPTION_KEYS = JSON.stringify({ v1: Buffer.alloc(32, 9).toString("base64") });
    process.env.PAYSTACK_SECRET_KEY = "sk_test_billingwebhooksecret";
  });

  it("starts each new business on one bounded Growth trial", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "trial-created");
    const overview = await source.owner.query(api.billing.overview, { now: Date.now() });
    expect(overview).toMatchObject({ businessId: source.businessId, plan: "trial", status: "trialing", automation: true, assistedConversationLimit: TRIAL_ASSISTED_CONVERSATIONS, readOnly: false });
    expect(await harness.run((ctx) => ctx.db.query("businessSubscriptions").collect())).toHaveLength(1);
  });

  it("counts an AI-assisted customer chat once and stops at the trial limit", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "usage-metering");
    const first = await conversation(harness, source.businessId, "001");
    const business = await harness.run((ctx) => ctx.db.get(source.businessId));
    expect(business).not.toBeNull();
    await harness.run(async (ctx) => {
      expect(await reserveAssistedConversation(ctx, { business: business!, conversationId: first })).toBe(true);
      expect(await reserveAssistedConversation(ctx, { business: business!, conversationId: first })).toBe(true);
    });
    const subscription = await harness.run((ctx) => ctx.db.query("businessSubscriptions").withIndex("by_business", (q) => q.eq("businessId", source.businessId)).unique());
    await harness.run(async (ctx) => {
      const usage = await ctx.db.query("billingUsagePeriods").withIndex("by_business_metric_period", (q) => q.eq("businessId", source.businessId).eq("metric", "assisted_conversation").eq("periodStart", subscription!.currentPeriodStart!)).unique();
      expect(usage?.quantity).toBe(1);
      await ctx.db.patch(usage!._id, { quantity: TRIAL_ASSISTED_CONVERSATIONS });
    });
    const second = await conversation(harness, source.businessId, "002");
    expect(await harness.run((ctx) => reserveAssistedConversation(ctx, { business: business!, conversationId: second }))).toBe(false);
  });

  it("allows Starter AI drafts while keeping automated replies disabled", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "starter-drafts");
    await harness.mutation(internal.billing.prepareCheckout, { ownerId: "google:starter-drafts", reference: "px_starter_drafts", plan: "starter", billingInterval: "monthly", providerPlanCode: "PLN_starter", amountKobo: BILLING_PLANS.starter.monthlyAmountKobo });
    await harness.mutation(internal.billing.reconcileVerifiedPayment, { reference: "px_starter_drafts", amountKobo: BILLING_PLANS.starter.monthlyAmountKobo, currency: "NGN", paidAt: Date.now() });
    const chat = await conversation(harness, source.businessId, "starter");
    const business = await harness.run((ctx) => ctx.db.get(source.businessId));
    expect(await harness.run((ctx) => reserveAssistedConversation(ctx, { business: business!, conversationId: chat }))).toBe(true);
    expect(await source.owner.query(api.billing.overview, { now: Date.now() })).toMatchObject({ plan: "starter", automation: false, assistedConversationsUsed: 1, assistedConversationLimit: 300 });
  });

  it("rejects a verified payment when the amount is tampered with", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "amount-mismatch");
    await harness.mutation(internal.billing.prepareCheckout, { ownerId: "google:amount-mismatch", reference: "px_amount_test", plan: "starter", billingInterval: "monthly", providerPlanCode: "PLN_starter", amountKobo: BILLING_PLANS.starter.monthlyAmountKobo });
    await expect(harness.mutation(internal.billing.reconcileVerifiedPayment, { reference: "px_amount_test", amountKobo: 100, currency: "NGN", paidAt: Date.now() })).rejects.toThrow("BILLING_PAYMENT_MISMATCH");
    expect((await source.owner.query(api.billing.overview, { now: Date.now() }))?.plan).toBe("trial");
  });

  it("activates the purchased plan idempotently and keeps another tenant isolated", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "paid-owner");
    const other = await tenant(harness, "other-owner");
    await harness.mutation(internal.billing.prepareCheckout, { ownerId: "google:paid-owner", reference: "px_paid_test", plan: "growth", billingInterval: "annual", providerPlanCode: "PLN_growthannual", amountKobo: BILLING_PLANS.growth.annualAmountKobo });
    const payment = { reference: "px_paid_test", amountKobo: BILLING_PLANS.growth.annualAmountKobo, currency: "NGN", paidAt: Date.now(), transactionId: "txn_1", providerPlanCode: "PLN_growthannual", providerCustomerCode: "CUS_1", providerSubscriptionCode: "SUB_1", providerEmailToken: "email-token" };
    expect(await harness.mutation(internal.billing.reconcileVerifiedPayment, payment)).toBe(true);
    expect(await harness.mutation(internal.billing.reconcileVerifiedPayment, payment)).toBe(true);
    expect(await harness.run((ctx) => ctx.db.query("billingPayments").collect())).toHaveLength(1);
    expect(await source.owner.query(api.billing.overview, { now: Date.now() })).toMatchObject({ plan: "growth", status: "active", billingInterval: "annual", amountKobo: BILLING_PLANS.growth.annualAmountKobo });
    expect((await other.owner.query(api.billing.overview, { now: Date.now() }))?.plan).toBe("trial");
  });

  it("deduplicates webhook events and enters a seven-day grace period on renewal failure", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "grace-period");
    await harness.mutation(internal.billing.prepareCheckout, { ownerId: "google:grace-period", reference: "px_grace_test", plan: "starter", billingInterval: "monthly", providerPlanCode: "PLN_starter", amountKobo: BILLING_PLANS.starter.monthlyAmountKobo });
    await harness.mutation(internal.billing.reconcileVerifiedPayment, { reference: "px_grace_test", amountKobo: BILLING_PLANS.starter.monthlyAmountKobo, currency: "NGN", paidAt: Date.now(), providerCustomerCode: "CUS_GRACE", providerSubscriptionCode: "SUB_GRACE" });
    const event = { eventDigest: "digest-failure", eventType: "invoice.payment_failed", providerSubscriptionCode: "SUB_GRACE" };
    expect(await harness.mutation(internal.billing.processWebhook, event)).toEqual({ processed: true });
    expect(await harness.mutation(internal.billing.processWebhook, event)).toEqual({ processed: true });
    const overview = await source.owner.query(api.billing.overview, { now: Date.now() });
    expect(overview?.status).toBe("past_due");
    expect(overview?.readOnly).toBe(false);
    expect(await harness.run((ctx) => ctx.db.query("billingWebhookEvents").collect())).toHaveLength(1);
  });

  it("does not extend grace when Paystack sends a later failure event", async () => {
    const harness = createHarness();
    await tenant(harness, "fixed-grace");
    await harness.mutation(internal.billing.prepareCheckout, { ownerId: "google:fixed-grace", reference: "px_fixed_grace", plan: "growth", billingInterval: "monthly", providerPlanCode: "PLN_growth", amountKobo: BILLING_PLANS.growth.monthlyAmountKobo });
    await harness.mutation(internal.billing.reconcileVerifiedPayment, { reference: "px_fixed_grace", amountKobo: BILLING_PLANS.growth.monthlyAmountKobo, currency: "NGN", paidAt: Date.now(), providerSubscriptionCode: "SUB_FIXED_GRACE" });
    await harness.mutation(internal.billing.processWebhook, { eventDigest: "failure-one", eventType: "invoice.payment_failed", providerSubscriptionCode: "SUB_FIXED_GRACE" });
    const firstGrace = Date.now() + PAYMENT_GRACE_DAYS * 86_400_000;
    vi.advanceTimersByTime(3 * 86_400_000);
    await harness.mutation(internal.billing.processWebhook, { eventDigest: "failure-two", eventType: "invoice.payment_failed", providerSubscriptionCode: "SUB_FIXED_GRACE" });
    const subscription = await harness.run((ctx) => ctx.db.query("businessSubscriptions").withIndex("by_provider_subscription", (q) => q.eq("provider", "paystack").eq("providerSubscriptionCode", "SUB_FIXED_GRACE")).unique());
    expect(subscription?.graceEndsAt).toBe(firstGrace);
  });

  it("resets annual-plan usage monthly and clamps calendar renewals", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "annual-window");
    await harness.mutation(internal.billing.prepareCheckout, { ownerId: "google:annual-window", reference: "px_annual_window", plan: "growth", billingInterval: "annual", providerPlanCode: "PLN_growthannual", amountKobo: BILLING_PLANS.growth.annualAmountKobo });
    await harness.mutation(internal.billing.reconcileVerifiedPayment, { reference: "px_annual_window", amountKobo: BILLING_PLANS.growth.annualAmountKobo, currency: "NGN", paidAt: Date.now() });
    const business = await harness.run((ctx) => ctx.db.get(source.businessId));
    const access = await harness.run((ctx) => billingAccess(ctx, business!));
    expect(access.assistedConversationsUsed).toBe(0);
    expect(access.periodStart).toBe(Date.now());
    expect(access.periodEnd).toBe(periodEndFrom(Date.now(), "monthly"));
    expect(annualUsageWindow(Date.UTC(2027, 0, 31, 12), Date.UTC(2027, 2, 30, 12))).toEqual({ start: Date.UTC(2027, 1, 28, 12), end: Date.UTC(2027, 2, 31, 12) });
    expect(periodEndFrom(Date.UTC(2027, 0, 31, 12), "monthly")).toBe(Date.UTC(2027, 1, 28, 12));
    expect(periodEndFrom(Date.UTC(2028, 1, 29, 12), "annual")).toBe(Date.UTC(2029, 1, 28, 12));
  });

  it("rejects unsigned and oversized Paystack webhooks", async () => {
    const harness = createHarness();
    const body = JSON.stringify({ event: "charge.success", data: {} });
    const unsigned = await harness.fetch("/api/webhook/paystack", { method: "POST", body });
    expect(unsigned.status).toBe(401);
    const oversized = await harness.fetch("/api/webhook/paystack", { method: "POST", headers: { "content-length": "256001" }, body });
    expect(oversized.status).toBe(413);
  });

  it("accepts a valid signed Paystack event exactly once", async () => {
    const harness = createHarness();
    await tenant(harness, "signed-webhook");
    await harness.mutation(internal.billing.prepareCheckout, { ownerId: "google:signed-webhook", reference: "px_signed_webhook", plan: "starter", billingInterval: "monthly", providerPlanCode: "PLN_starter", amountKobo: BILLING_PLANS.starter.monthlyAmountKobo });
    const body = JSON.stringify({ event: "charge.success", data: { reference: "px_signed_webhook", status: "success", amount: BILLING_PLANS.starter.monthlyAmountKobo, currency: "NGN", paid_at: new Date().toISOString(), plan: { plan_code: "PLN_starter" }, customer: { customer_code: "CUS_SIGNED" }, subscription: { subscription_code: "SUB_SIGNED", email_token: "signed-token" } } });
    const signature = createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!).update(body).digest("hex");
    const request = () => harness.fetch("/api/webhook/paystack", { method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": signature }, body });
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    expect(await harness.run((ctx) => ctx.db.query("billingPayments").collect())).toHaveLength(1);
    expect(await harness.run((ctx) => ctx.db.query("billingWebhookEvents").collect())).toHaveLength(1);
  });

  it("records a signed payment mismatch once without applying access", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "webhook-mismatch");
    await harness.mutation(internal.billing.prepareCheckout, { ownerId: "google:webhook-mismatch", reference: "px_webhook_mismatch", plan: "starter", billingInterval: "monthly", providerPlanCode: "PLN_starter", amountKobo: BILLING_PLANS.starter.monthlyAmountKobo });
    const event = { eventDigest: "mismatch-digest", eventType: "charge.success", reference: "px_webhook_mismatch", currency: "NGN", paidAt: Date.now(), providerPlanCode: "PLN_starter", amountKobo: 100 };
    expect(await harness.mutation(internal.billing.processWebhook, event)).toEqual({ processed: false });
    expect(await harness.mutation(internal.billing.processWebhook, event)).toEqual({ processed: false });
    const events = await harness.run((ctx) => ctx.db.query("billingWebhookEvents").collect());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ state: "failed", code: "BILLING_PAYMENT_MISMATCH" });
    expect((await source.owner.query(api.billing.overview, { now: Date.now() }))?.plan).toBe("trial");
  });

  it("expires access and disables automation after the period and grace end", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "expired-access");
    await harness.run(async (ctx) => {
      const subscription = await ctx.db.query("businessSubscriptions").withIndex("by_business", (q) => q.eq("businessId", source.businessId)).unique();
      await ctx.db.patch(subscription!._id, { status: "past_due", currentPeriodEnd: Date.now() - 10_000, graceEndsAt: Date.now() - 1 });
      await ctx.db.patch(source.businessId, { customerAutoReplyEnabled: true, groupAutoReplyEnabled: true, aiEnabled: true, killSwitch: false });
    });
    await harness.mutation(internal.billing.sweep, {});
    const business = await harness.run((ctx) => ctx.db.get(source.businessId));
    expect(business).toMatchObject({ customerAutoReplyEnabled: false, groupAutoReplyEnabled: false, aiEnabled: false, killSwitch: true });
    expect((await source.owner.query(api.billing.overview, { now: Date.now() }))?.readOnly).toBe(true);
  });
});
