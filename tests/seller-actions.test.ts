import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { canTransitionOrder, journeyForOrder, transitionOrder } from "../convex/lib/sellerActions";
import { createHarness, tenant, type Harness } from "./harness";

async function seedActionableTask(harness: Harness, businessId: Id<"businesses">, options: { availableAt?: number; reason?: "buying_signal" | "asked_no_order" | "awaiting_payment"; revision?: number; manualSentAt?: number } = {}) {
  const now = Date.now();
  const identityKey = `identity-${Math.random()}`;
  return harness.run(async (ctx) => {
    const customerId = await ctx.db.insert("customers", { businessId, identityKey, name: "Ada", phone: "2348000000001@s.whatsapp.net", totalValue: 0, lastInteraction: now, funnelStage: "intent", tags: [] });
    const conversationId = await ctx.db.insert("conversations", { businessId, customerId, identityKey, revision: options.revision ?? 1, lastEventAt: now, lastInboundAt: now, messageCount: 1 });
    const interactionId = await ctx.db.insert("interactions", { businessId, customerId, conversationId, role: "customer", content: "How much is this?", timestamp: now - 3600000, messageType: "text" });
    const opportunityId = await ctx.db.insert("missedRevenueOpportunities", { businessId, customerId, conversationId, interactionId, classifierVersion: "test", classifierConfidence: 1, ruleIds: ["test"], triggerAt: now - 3600000, responseWindowMinutes: 15, dueAt: now - 2700000, conversationRevision: options.revision ?? 1, state: "missed", expiresAt: now + 86400000 });
    const draftText = "Hi Ada, do you still need help?";
    const taskId = await ctx.db.insert("followUpTasks", { businessId, customerId, reason: options.reason ?? "buying_signal", dueAt: options.availableAt ?? now - 1, status: options.manualSentAt ? "done" : "pending", createdAt: now - 3000000, opportunityId, conversationId, triggerInteractionId: interactionId, triggerAt: now - 3600000, conversationRevision: options.revision ?? 1, journeyStage: "intent", draftText, draftSource: "template", draftVersion: "test", draftHash: "synthetic-draft-hash", aiState: "disabled", availableAt: options.availableAt ?? now - 1, ...(options.manualSentAt ? { manuallySentAt: options.manualSentAt, completedAt: options.manualSentAt, sellerApprovedDraftHash: "synthetic-draft-hash" } : {}), actionKey: `test:${identityKey}`, estimatedValue: 25000, reasonSnapshot: "Synthetic reason" });
    return { customerId, conversationId, interactionId, opportunityId, taskId };
  });
}

describe("Phase 4 seller actions", () => {
  it("allows only explicit order transitions and advances journey stages legally", () => {
    expect(canTransitionOrder("pending", "awaiting_payment")).toBe(true);
    expect(canTransitionOrder("pending", "delivered")).toBe(false);
    expect(() => transitionOrder("pending", "delivered")).toThrow("ILLEGAL_ORDER_TRANSITION");
    expect(journeyForOrder("viewer", "awaiting_payment")).toBe("awaiting_payment");
    expect(journeyForOrder("intent", "paid")).toBe("paid");
    expect(journeyForOrder("paid", "cancelled")).toBe("paid");
  });

  it("ranks payment and buying actions ahead of stalled inquiries", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const stalled = await seedActionableTask(harness, source.businessId, { reason: "asked_no_order" });
    const buying = await seedActionableTask(harness, source.businessId, { reason: "buying_signal" });
    const payment = await seedActionableTask(harness, source.businessId, { reason: "awaiting_payment" });
    const queue = await source.owner.query(api.sellerActions.actionQueue, { businessId: source.businessId });
    expect(queue.map((entry) => entry.taskId)).toEqual([payment.taskId, buying.taskId, stalled.taskId]);
  });

  it("records a manual-send claim idempotently and blocks stale conversation claims", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const first = await seedActionableTask(harness, source.businessId);
    await source.owner.mutation(api.sellerActions.recordManualSend, { businessId: source.businessId, taskId: first.taskId, idempotencyKey: "manual:one" });
    await source.owner.mutation(api.sellerActions.recordManualSend, { businessId: source.businessId, taskId: first.taskId, idempotencyKey: "manual:one" });
    const events = await harness.run((ctx) => ctx.db.query("sellerActionEvents").collect());
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("manual_send_claim");
    expect((await harness.run((ctx) => ctx.db.get(first.taskId)))?.status).toBe("done");

    const stale = await seedActionableTask(harness, source.businessId);
    await harness.run((ctx) => ctx.db.patch(stale.conversationId, { revision: 2 }));
    await expect(source.owner.mutation(api.sellerActions.recordManualSend, { businessId: source.businessId, taskId: stale.taskId, idempotencyKey: "manual:stale" })).rejects.toThrow("STALE_TASK");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates an awaiting-payment reminder without cancelling it", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const task = await seedActionableTask(harness, source.businessId, { manualSentAt: Date.now() - 1000 });
    const orderId = await source.owner.mutation(api.sellerActions.createOrder, { businessId: source.businessId, customerId: task.customerId, sourceTaskId: task.taskId, totalAmount: 25000, status: "awaiting_payment", idempotencyKey: "order:awaiting" });
    const reminders = await harness.run((ctx) => ctx.db.query("followUpTasks").withIndex("by_customer", (builder) => builder.eq("customerId", task.customerId)).collect());
    expect(reminders.find((entry) => entry.orderId === orderId && entry.reason === "awaiting_payment")).toMatchObject({ status: "pending" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("isolates outcomes by tenant and creates one conservative attribution", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const other = await tenant(harness, "other-seller");
    const task = await seedActionableTask(harness, source.businessId, { manualSentAt: Date.now() - 1000 });
    const orderId = await source.owner.mutation(api.sellerActions.createOrder, { businessId: source.businessId, customerId: task.customerId, sourceTaskId: task.taskId, totalAmount: 25000, status: "awaiting_payment", idempotencyKey: "order:source" });
    await expect(other.owner.mutation(api.sellerActions.updateOrderStatus, { businessId: other.businessId, orderId, status: "paid", idempotencyKey: "order:other" })).rejects.toThrow("NOT_FOUND");
    await source.owner.mutation(api.sellerActions.updateOrderStatus, { businessId: source.businessId, orderId, status: "paid", idempotencyKey: "order:paid" });
    await source.owner.mutation(api.sellerActions.updateOrderStatus, { businessId: source.businessId, orderId, status: "paid", idempotencyKey: "order:paid:repeat" });
    await source.owner.mutation(api.sellerActions.createOrder, { businessId: source.businessId, customerId: task.customerId, sourceTaskId: task.taskId, totalAmount: 30000, status: "paid", idempotencyKey: "order:second" });
    const attributions = await harness.run((ctx) => ctx.db.query("revenueAttributions").collect());
    expect(attributions).toHaveLength(1);
    expect(attributions[0]).toMatchObject({ state: "claimed", claimedValue: 25000, confirmedValue: 0, evidenceLevel: "seller_recorded" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects attribution without timely manual-send evidence and reverses cancelled paid claims", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const noClaim = await seedActionableTask(harness, source.businessId);
    await source.owner.mutation(api.sellerActions.createOrder, { businessId: source.businessId, customerId: noClaim.customerId, sourceTaskId: noClaim.taskId, totalAmount: 12000, status: "paid", idempotencyKey: "order:no-manual" });
    expect(await harness.run((ctx) => ctx.db.query("revenueAttributions").collect())).toHaveLength(0);

    const tooOld = await seedActionableTask(harness, source.businessId, { manualSentAt: Date.now() - 8 * 86400000 });
    await source.owner.mutation(api.sellerActions.createOrder, { businessId: source.businessId, customerId: tooOld.customerId, sourceTaskId: tooOld.taskId, totalAmount: 14000, status: "paid", idempotencyKey: "order:outside-window" });
    let attributions = await harness.run((ctx) => ctx.db.query("revenueAttributions").collect());
    expect(attributions).toHaveLength(1);
    expect(attributions[0]).toMatchObject({ state: "rejected", claimedValue: 0, confirmedValue: 0 });

    const reversible = await seedActionableTask(harness, source.businessId, { manualSentAt: Date.now() - 1000 });
    const orderId = await source.owner.mutation(api.sellerActions.createOrder, { businessId: source.businessId, customerId: reversible.customerId, sourceTaskId: reversible.taskId, totalAmount: 16000, status: "paid", idempotencyKey: "order:reversible" });
    await source.owner.mutation(api.sellerActions.updateOrderStatus, { businessId: source.businessId, orderId, status: "cancelled", idempotencyKey: "order:reverse" });
    attributions = await harness.run((ctx) => ctx.db.query("revenueAttributions").collect());
    expect(attributions.find((entry) => entry.orderId === orderId)).toMatchObject({ state: "reversed", claimedValue: 16000, confirmedValue: 0 });
    const metrics = await source.owner.query(api.measurement.dashboard, { businessId: source.businessId });
    expect(metrics.claimedRecoveredRevenue).toBe(0);
  });

  it("creates and cancels deferred stalled-inquiry tasks on later conversation activity", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const seeded = await seedActionableTask(harness, source.businessId);
    const stalledId = await harness.mutation(internal.sellerActions.rebuildStalledTask, { businessId: source.businessId, customerId: seeded.customerId, conversationId: seeded.conversationId, interactionId: seeded.interactionId });
    expect(stalledId).not.toBeNull();
    await harness.mutation(internal.maintenance.cancelCustomerTasks, { customerId: seeded.customerId, since: Date.now() });
    expect((await harness.run((ctx) => ctx.db.get(stalledId!)))?.status).toBe("cancelled");
  });

  it("records Phase 4 through Phase 6 checkpoints without historical backfill", async () => {
    const harness = createHarness();
    expect(await harness.mutation(internal.migrations.phase4SellerActions, { dryRun: true })).toMatchObject({ complete: true, historicalBackfill: false });
    expect(await harness.mutation(internal.migrations.phase5Measurement, { dryRun: true })).toMatchObject({ complete: true, historicalBackfill: false });
    expect(await harness.mutation(internal.migrations.phase6Extensions, { dryRun: true })).toMatchObject({ complete: true, historicalBackfill: false });
  });
});
