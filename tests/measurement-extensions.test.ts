import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { createHarness, tenant } from "./harness";

describe("Phase 5 measurement and Phase 6 extensions", () => {
  it("separates seller-claimed from confirmed recovered revenue", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const now = Date.now();
    await harness.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", { businessId: source.businessId, identityKey: "measure-one", name: "Ada", phone: "2348000000001@s.whatsapp.net", totalValue: 10000, lastInteraction: now, tags: [] });
      const conversationId = await ctx.db.insert("conversations", { businessId: source.businessId, customerId, identityKey: "measure-one", revision: 1, lastEventAt: now, messageCount: 1 });
      const interactionId = await ctx.db.insert("interactions", { businessId: source.businessId, customerId, conversationId, role: "customer", content: "Thanks", timestamp: now, messageType: "text" });
      const opportunityId = await ctx.db.insert("missedRevenueOpportunities", { businessId: source.businessId, customerId, conversationId, interactionId, classifierVersion: "test", classifierConfidence: 1, ruleIds: ["test"], triggerAt: now - 10000, responseWindowMinutes: 15, dueAt: now - 5000, state: "missed", expiresAt: now + 86400000 });
      const taskId = await ctx.db.insert("followUpTasks", { businessId: source.businessId, customerId, reason: "buying_signal", dueAt: now - 3000, status: "done", createdAt: now - 4000, opportunityId, manuallySentAt: now - 2000, completedAt: now - 2000 });
      const orderId = await ctx.db.insert("orders", { businessId: source.businessId, customerId, sourceTaskId: taskId, items: [], totalAmount: 10000, status: "paid", createdAt: now - 1000, paidAt: now - 1000 });
      await ctx.db.insert("sellerActionEvents", { businessId: source.businessId, customerId, taskId, type: "manual_send_claim", idempotencyKey: "measure:manual", at: now - 2000 });
      await ctx.db.insert("revenueAttributions", { businessId: source.businessId, customerId, taskId, orderId, opportunityId, manualSentAt: now - 2000, orderWonAt: now - 1000, windowDays: 7, claimedValue: 10000, confirmedValue: 0, evidenceLevel: "seller_recorded", state: "claimed", reason: "Synthetic seller-recorded evidence.", createdAt: now });
    });
    const metrics = await source.owner.query(api.measurement.dashboard, { businessId: source.businessId });
    expect(metrics).toMatchObject({ leadsCaptured: 1, buyersRepliedAfterFollowUp: 1, manualFollowUpClaims: 1, missedOpportunities: 1, orders: 1, paidOrders: 1, claimedRecoveredRevenue: 10000, confirmedRecoveredRevenue: 0 });
    const audit = await source.owner.query(api.measurement.attributionAudit, { businessId: source.businessId });
    expect(audit[0]).toMatchObject({ claimedValue: 10000, confirmedValue: 0, state: "claimed" });
    const other = await tenant(harness, "measurement-other");
    await expect(other.owner.query(api.measurement.dashboard, { businessId: source.businessId })).rejects.toThrow("NOT_FOUND");
  });

  it("keeps Status viewers opaque, opt-in, manual-only, and tenant-isolated", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const other = await tenant(harness, "other-seller");
    await harness.run((ctx) => ctx.db.insert("statusObservations", { businessId: source.businessId, sessionId: source.sessionId, statusMessageId: "status-1", viewerIdentityKey: "opaque-hash-only", observedAt: Date.now(), expiresAt: Date.now() + 86400000 }));
    expect(await source.owner.query(api.extensions.statusViewers, { businessId: source.businessId })).toEqual([]);
    await source.owner.mutation(api.extensions.updateSettings, { businessId: source.businessId, statusViewerListEnabled: true, automatedSendingRequested: true });
    const viewers = await source.owner.query(api.extensions.statusViewers, { businessId: source.businessId });
    expect(viewers[0]).toMatchObject({ opaqueViewerKey: "opaque-hash-only", statusMessageId: "status-1" });
    expect(await harness.run((ctx) => ctx.db.query("customers").collect())).toHaveLength(0);
    expect(await harness.run((ctx) => ctx.db.query("followUpTasks").collect())).toHaveLength(0);
    expect((await source.owner.query(api.extensions.settings, { businessId: source.businessId }))).toMatchObject({ automatedSendingRequested: true, automatedSendingAvailable: false });
    await expect(other.owner.query(api.extensions.statusViewers, { businessId: source.businessId })).rejects.toThrow("NOT_FOUND");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports risk while keeping dispatch unqualified", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await harness.run(async (ctx) => {
      await ctx.db.patch(source.sessionId, { lastError: "SYNTHETIC_PROVIDER_FAILURE" });
      await ctx.db.insert("foundationAudit", { businessId: source.businessId, kind: "disconnect_dead_letter", correlationId: "risk-one", code: "SYNTHETIC", at: Date.now(), expiresAt: Date.now() + 86400000 });
    });
    const readiness = await source.owner.query(api.extensions.readiness, { businessId: source.businessId });
    expect(readiness.dispatchQualified).toBe(false);
    expect(readiness.killSwitch).toBe(true);
    expect(readiness.recentRiskEvents).toBeGreaterThanOrEqual(2);
    expect(readiness.reasons.join(" ")).toContain("idempotency");
    expect(fetch).not.toHaveBeenCalled();
  });
});
