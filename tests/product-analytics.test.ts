import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { createHarness, registeredGoogle, tenant } from "./harness";

describe("product learning and incident measurement", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("records workspace activity, demo state, incidents, and structured support", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await source.owner.mutation(api.productAnalytics.touchWorkspace, { businessId: source.businessId });
    await source.owner.mutation(api.productAnalytics.recordDemo, { businessId: source.businessId, outcome: "completed" });
    expect(await source.owner.query(api.productAnalytics.demoState, { businessId: source.businessId })).toMatchObject({ completedAt: expect.any(Number), dismissedAt: null });

    await harness.mutation(internal.foundation.updateSession, { sessionId: source.sessionId, generation: 1, state: "error", code: "SYNTHETIC_PROVIDER_FAILURE", health: true });
    expect(await source.owner.query(api.productAnalytics.incidents, { businessId: source.businessId })).toEqual([expect.objectContaining({ status: "active", kind: "provider_error" })]);
    await harness.mutation(internal.foundation.updateSession, { sessionId: source.sessionId, generation: 1, state: "connected", health: true });
    expect((await source.owner.query(api.productAnalytics.incidents, { businessId: source.businessId }))[0]).toMatchObject({ status: "resolved" });

    await source.owner.mutation(api.productAnalytics.createSupportRequest, { businessId: source.businessId, category: "connection", severity: "normal", summary: "Connection dropped", details: "The connection dropped twice while the workspace was active." });
    expect(await source.owner.query(api.productAnalytics.supportQueue, { businessId: source.businessId })).toEqual([expect.objectContaining({ summary: "Connection dropped", status: "open" })]);
  });

  it("reports learning metrics and evidence to an authorized admin", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "google:operator");
    const harness = createHarness();
    const source = await tenant(harness, "learning-seller");
    const admin = await registeredGoogle(harness, "operator");
    const now = Date.now();
    await harness.run(async (ctx) => {
      const metrics = await ctx.db.query("businessProductMetrics").withIndex("by_business", (builder) => builder.eq("businessId", source.businessId)).unique();
      if (!metrics) throw new Error("missing metrics");
      await ctx.db.patch(metrics._id, { firstConnectedAt: now - 9_000, firstUsefulOpportunityAt: now - 5_000, firstSuggestedActionAt: now - 4_000, firstSuggestedActionCompletedAt: now - 2_000, automationOptInAt: now - 3_000 });
      const customerId = await ctx.db.insert("customers", { businessId: source.businessId, name: "Buyer", phone: "2348000000001@s.whatsapp.net", totalValue: 0, lastInteraction: now, tags: [] });
      const conversationId = await ctx.db.insert("conversations", { businessId: source.businessId, customerId, identityKey: "learning", revision: 2, lastEventAt: now, messageCount: 2 });
      const inboundId = await ctx.db.insert("interactions", { businessId: source.businessId, customerId, conversationId, role: "customer", content: "How much be this?", timestamp: now - 2_000, messageType: "text", classifierLabel: "buying_signal", classifierVersion: "test" });
      await ctx.db.insert("messageLabels", { businessId: source.businessId, customerId, interactionId: inboundId, label: "buying_signal", predictedLabel: "buying_signal", messageType: "text", language: "pidgin", evidenceTags: ["ambiguous_language"], sellerVertical: "fashion", labeledBy: "google:learning-seller", labeledAt: now });
      const dispatchId = await ctx.db.insert("assistantDispatches", { businessId: source.businessId, interactionId: inboundId, customerId, sessionId: source.sessionId, target: "2348000000001@s.whatsapp.net", isGroup: false, content: "It costs ₦10,000.", state: "accepted", attempts: 1, createdAt: now - 1_000, updatedAt: now - 1_000 });
      const replyId = await ctx.db.insert("interactions", { businessId: source.businessId, customerId, conversationId, role: "owner", content: "It costs ₦10,000.", timestamp: now - 1_000, messageType: "text", assistantDispatchId: dispatchId });
      await ctx.db.insert("assistantReplyFeedback", { businessId: source.businessId, interactionId: replyId, dispatchId, rating: "correct", recordedBy: "google:learning-seller", recordedAt: now });
    });
    const learning = await admin.query(api.admin.learning, { rangeDays: 30 });
    expect(learning.metrics).toMatchObject({ connectedBusinesses: 1, opportunityBusinesses: 1, businessesCompletingActions: 1, automationOptedIn: 1, labeledMessages: 1, replyFeedbackSamples: 1 });
    expect(learning.evidence).toMatchObject({ pidgin: 1, ambiguousLanguage: 1, sellerVerticals: [{ vertical: "fashion", samples: 1 }] });
  });
});
