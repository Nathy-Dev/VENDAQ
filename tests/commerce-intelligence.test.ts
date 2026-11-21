import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { createHarness, tenant, type Harness } from "./harness";

let fixtureCounter = 0;

async function directInteraction(harness: Harness, source: Awaited<ReturnType<typeof tenant>>, content: string, options: { role?: "customer" | "owner"; messageType?: "text" | "image"; imageAnalysis?: string } = {}) {
  const now = Date.now();
  fixtureCounter += 1;
  const suffix = String(fixtureCounter).padStart(9, "0");
  return await harness.run(async (ctx) => {
    const identityKey = `commerce-fixture-${suffix}`;
    const customerId = await ctx.db.insert("customers", { businessId: source.businessId, phone: `2348${suffix}@s.whatsapp.net`, identityKey, name: "Commerce buyer", totalValue: 0, lastInteraction: now, isGroup: false, tags: ["captured"] });
    const conversationId = await ctx.db.insert("conversations", { businessId: source.businessId, customerId, identityKey, revision: 1, lastEventAt: now, messageCount: 1 });
    const interactionId = await ctx.db.insert("interactions", {
      businessId: source.businessId, customerId, conversationId, sessionId: source.sessionId,
      role: options.role ?? "customer", content, timestamp: now, receivedAt: now,
      messageType: options.messageType ?? "text", manualReviewRequired: false, isGroup: false,
      ...(options.imageAnalysis ? { imageAnalysis: options.imageAnalysis, imageAnalysisState: "completed" as const } : {}),
    });
    return { customerId, conversationId, interactionId };
  });
}

describe("one-to-one commerce intelligence", () => {
  it("scopes knowledge to the owning business", async () => {
    const harness = createHarness();
    const first = await tenant(harness, "knowledge-first");
    const second = await tenant(harness, "knowledge-second");
    await first.owner.mutation(api.commerceIntelligence.saveKnowledge, { businessId: first.businessId, title: "Lagos delivery", kind: "delivery", content: "Delivery within Lagos takes one to two business days." });
    expect(await first.owner.query(api.commerceIntelligence.listKnowledge, { businessId: first.businessId })).toHaveLength(1);
    await expect(second.owner.query(api.commerceIntelligence.listKnowledge, { businessId: first.businessId })).rejects.toThrow();
    expect(await second.owner.query(api.commerceIntelligence.listKnowledge, { businessId: second.businessId })).toEqual([]);
  });

  it("deduplicates promises and creates an owner rescue for high-risk exceptions", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "promise-rescue");
    const promise = await directInteraction(harness, source, "I will pay tomorrow, please keep it for me.");
    await harness.mutation(internal.commerceIntelligence.captureFromInteraction, { interactionId: promise.interactionId });
    await harness.mutation(internal.commerceIntelligence.captureFromInteraction, { interactionId: promise.interactionId });
    expect(await harness.run((ctx) => ctx.db.query("conversationCommitments").collect())).toHaveLength(1);

    const complaint = await directInteraction(harness, source, "This is a scam. I still have no refund and I will call my lawyer.");
    await harness.mutation(internal.commerceIntelligence.captureFromInteraction, { interactionId: complaint.interactionId });
    const exceptions = await harness.run((ctx) => ctx.db.query("commerceExceptions").collect());
    const rescues = await harness.run((ctx) => ctx.db.query("ownerRescueRequests").collect());
    expect(exceptions).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "critical", state: "waiting_on_business" })]));
    expect(rescues).toEqual(expect.arrayContaining([expect.objectContaining({ state: "open" })]));
  });

  it("keeps receipt evidence separate from verified payment", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "receipt-review");
    const receipt = await directInteraction(harness, source, "Image analysis: This appears to be a successful bank transfer receipt for NGN 25,000. Reference ABC12345.", { messageType: "image", imageAnalysis: "This appears to be a payment receipt." });
    await harness.mutation(internal.commerceIntelligence.captureFromInteraction, { interactionId: receipt.interactionId });
    const [proof] = await harness.run((ctx) => ctx.db.query("paymentProofs").collect());
    expect(proof).toMatchObject({ receiptState: "review_required", verificationState: "unavailable", extractedAmount: 25000 });
    expect(proof.verificationState).not.toBe("verified");
    expect(await harness.query(internal.commerceIntelligence.gateForAssistant, { interactionId: receipt.interactionId })).toMatchObject({ holdingReply: expect.stringContaining("checking") });
  });

  it("grounds the assistant context in active knowledge and verified memory only", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "grounded-context");
    const interaction = await directInteraction(harness, source, "I wear size 42.");
    await source.owner.mutation(api.commerceIntelligence.saveKnowledge, { businessId: source.businessId, title: "Current price", kind: "price", content: "The blue shoe costs NGN 30,000." });
    const expired = await source.owner.mutation(api.commerceIntelligence.saveKnowledge, { businessId: source.businessId, title: "Old price", kind: "price", content: "The blue shoe costs NGN 20,000.", expiresAt: Date.now() - 1 });
    await harness.mutation(internal.commerceIntelligence.captureFromInteraction, { interactionId: interaction.interactionId });
    const [memory] = await harness.run((ctx) => ctx.db.query("customerMemories").collect());
    let context = await harness.query(internal.commerceIntelligence.assistantContext, { businessId: source.businessId, customerId: interaction.customerId, conversationId: interaction.conversationId, now: Date.now() });
    expect(context.knowledge.map((entry) => entry.title)).toEqual(["Current price"]);
    expect(context.memories).toEqual([]);
    await source.owner.mutation(api.commerceIntelligence.verifyMemory, { businessId: source.businessId, memoryId: memory._id, state: "verified" });
    context = await harness.query(internal.commerceIntelligence.assistantContext, { businessId: source.businessId, customerId: interaction.customerId, conversationId: interaction.conversationId, now: Date.now() });
    expect(context.memories).toEqual([expect.objectContaining({ key: "preferred_size", value: "42", state: "verified" })]);
    expect(expired).toBeDefined();
  });

  it("enforces negotiation limits and owner rescue ownership", async () => {
    const harness = createHarness();
    const first = await tenant(harness, "policy-first");
    const second = await tenant(harness, "policy-second");
    await first.owner.mutation(api.commerceIntelligence.saveNegotiationPolicy, { businessId: first.businessId, name: "Default limits", maximumDiscountPercent: 5, minimumPrice: 20000, freeDeliveryThreshold: 50000, requireApprovalBelow: 22000, allowedBundles: ["Two items with free delivery"] });
    expect(await first.owner.query(api.commerceIntelligence.negotiationPolicy, { businessId: first.businessId })).toMatchObject({ maximumDiscountPercent: 5, minimumPrice: 20000 });
    const request = await directInteraction(harness, first, "Can you give me your last price?");
    const holdingReply = await harness.mutation(internal.commerceIntelligence.createGenerationRescue, { interactionId: request.interactionId, reason: "discount_approval", question: "What discount can Pipelixr offer?", holdingReply: "Let me confirm the best approved price for you." });
    expect(holdingReply).toContain("confirm");
    const [rescue] = await harness.run((ctx) => ctx.db.query("ownerRescueRequests").collect());
    await expect(second.owner.mutation(api.commerceIntelligence.answerRescue, { businessId: first.businessId, rescueId: rescue._id, answer: "Give 10 percent" })).rejects.toThrow();
    await first.owner.mutation(api.commerceIntelligence.answerRescue, { businessId: first.businessId, rescueId: rescue._id, answer: "Offer no more than 5 percent." });
    expect((await harness.run((ctx) => ctx.db.get(rescue._id)))?.state).toBe("answered");
  });

  it("aggregates conversation and ad outcomes", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "outcomes");
    const first = await directInteraction(harness, source, "I want to order.");
    await source.owner.mutation(api.commerceIntelligence.recordOutcome, { businessId: source.businessId, customerId: first.customerId, conversationId: first.conversationId, outcome: "paid", value: 40000, sourceAdId: "ad-one" });
    const second = await directInteraction(harness, source, "The delivery fee is too high.");
    await source.owner.mutation(api.commerceIntelligence.recordOutcome, { businessId: source.businessId, customerId: second.customerId, conversationId: second.conversationId, outcome: "lost_delivery", objection: "Delivery fee", sourceAdId: "ad-one" });
    const insights = await source.owner.query(api.commerceIntelligence.insights, { businessId: source.businessId });
    expect(insights).toMatchObject({ total: 2, paid: 1, lost: 1, recordedValue: 40000 });
    expect(insights.topAds[0]).toMatchObject({ adId: "ad-one", conversations: 2, paid: 1, value: 40000 });
    expect(insights.topObjections[0]).toMatchObject({ objection: "Delivery fee", count: 1 });
  });

  it("updates a conversation result in place and reports only its current result", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "outcome-update");
    const interaction = await directInteraction(harness, source, "I am interested, but I need to confirm.");
    const firstId = await source.owner.mutation(api.commerceIntelligence.recordOutcome, { businessId: source.businessId, customerId: interaction.customerId, conversationId: interaction.conversationId, outcome: "qualified", sourceCampaignId: "Instagram Lagos" });
    const secondId = await source.owner.mutation(api.commerceIntelligence.recordOutcome, { businessId: source.businessId, customerId: interaction.customerId, conversationId: interaction.conversationId, outcome: "paid", value: 65000, sourceCampaignId: "Instagram Lagos" });
    expect(secondId).toBe(firstId);
    expect(await harness.run((ctx) => ctx.db.query("conversationOutcomes").collect())).toHaveLength(1);
    const intelligence = await source.owner.query(api.commerceIntelligence.conversationIntelligence, { businessId: source.businessId, customerId: interaction.customerId });
    expect(intelligence.latestOutcome).toMatchObject({ id: firstId, outcome: "paid", value: 65000, sourceCampaignId: "Instagram Lagos" });
    const insights = await source.owner.query(api.commerceIntelligence.insights, { businessId: source.businessId });
    expect(insights).toMatchObject({ total: 1, qualified: 0, paid: 1, recordedValue: 65000 });
    expect(insights.topAds[0]).toMatchObject({ adId: "Instagram Lagos", conversations: 1, paid: 1, value: 65000 });
  });

  it("rejects result evidence from another business", async () => {
    const harness = createHarness();
    const first = await tenant(harness, "outcome-evidence-first");
    const second = await tenant(harness, "outcome-evidence-second");
    const firstInteraction = await directInteraction(harness, first, "I want this product.");
    const foreignInteraction = await directInteraction(harness, second, "I paid already.");
    await expect(first.owner.mutation(api.commerceIntelligence.recordOutcome, { businessId: first.businessId, customerId: firstInteraction.customerId, conversationId: firstInteraction.conversationId, outcome: "paid", decisiveInteractionId: foreignInteraction.interactionId })).rejects.toThrow();
    expect(await harness.run((ctx) => ctx.db.query("conversationOutcomes").collect())).toEqual([]);
  });

  it("counts value only for paid private-chat results", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "paid-only-value");
    const paid = await directInteraction(harness, source, "Payment sent.");
    const booked = await directInteraction(harness, source, "Book me for Friday.");
    await source.owner.mutation(api.commerceIntelligence.recordOutcome, { businessId: source.businessId, customerId: paid.customerId, conversationId: paid.conversationId, outcome: "paid", value: 30000 });
    await source.owner.mutation(api.commerceIntelligence.recordOutcome, { businessId: source.businessId, customerId: booked.customerId, conversationId: booked.conversationId, outcome: "booked", value: 90000 });
    const insights = await source.owner.query(api.commerceIntelligence.insights, { businessId: source.businessId });
    expect(insights).toMatchObject({ total: 2, paid: 1, booked: 1, recordedValue: 30000 });
  });
});
