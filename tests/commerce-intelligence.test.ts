import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { aiTenant, createHarness, tenant, type Harness } from "./harness";

const rescuePrompt = "You represent a Nigerian retail business. Use only confirmed prices, negotiated discounts, and delivery terms. Ask for clarification when facts are missing, and refer uncertain customer requests to the owner in concise WhatsApp language.";
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
      aiProcessingEpoch: (await ctx.db.get(source.businessId))?.aiProcessingEpoch,
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
    const source = await aiTenant(harness, "promise-rescue");
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
    const source = await aiTenant(harness, "receipt-review");
    const receipt = await directInteraction(harness, source, "Image analysis: This appears to be a successful bank transfer receipt for NGN 25,000. Reference ABC12345.", { messageType: "image", imageAnalysis: "This appears to be a payment receipt." });
    await harness.mutation(internal.commerceIntelligence.captureFromInteraction, { interactionId: receipt.interactionId });
    const [proof] = await harness.run((ctx) => ctx.db.query("paymentProofs").collect());
    expect(proof).toMatchObject({ receiptState: "review_required", verificationState: "unavailable", extractedAmount: 25000 });
    expect(proof.verificationState).not.toBe("verified");
    expect(await harness.query(internal.commerceIntelligence.gateForAssistant, { interactionId: receipt.interactionId })).toMatchObject({ holdingReply: expect.stringContaining("checking") });
  });

  it("grounds the assistant context in active knowledge and verified memory only", async () => {
    const harness = createHarness();
    const source = await aiTenant(harness, "grounded-context");
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
    const first = await aiTenant(harness, "policy-first");
    const second = await tenant(harness, "policy-second");
    await first.owner.mutation(api.commerceIntelligence.saveNegotiationPolicy, { businessId: first.businessId, name: "Default limits", maximumDiscountPercent: 5, minimumPrice: 20000, freeDeliveryThreshold: 50000, requireApprovalBelow: 22000, allowedBundles: ["Two items with free delivery"] });
    expect(await first.owner.query(api.commerceIntelligence.negotiationPolicy, { businessId: first.businessId })).toMatchObject({ maximumDiscountPercent: 5, minimumPrice: 20000 });
    const request = await directInteraction(harness, first, "Can you give me your last price?");
    const holdingReply = await harness.mutation(internal.commerceIntelligence.createGenerationRescue, { interactionId: request.interactionId, reason: "discount_approval", question: "What discount can Pipelixr offer?", holdingReply: "Let me confirm the best approved price for you." });
    expect(holdingReply).toContain("confirm");
    const [rescue] = await harness.run((ctx) => ctx.db.query("ownerRescueRequests").collect());
    await expect(second.owner.mutation(api.commerceIntelligence.answerRescue, { businessId: first.businessId, rescueId: rescue._id, answer: "Give 10 percent" })).rejects.toThrow("NOT_FOUND");
    await first.owner.mutation(api.businessProfile.save, { businessId: first.businessId, systemPrompt: rescuePrompt, customerAutoReplyEnabled: true, groupAutoReplyEnabled: false });
    await first.owner.mutation(api.commerceIntelligence.answerRescue, { businessId: first.businessId, rescueId: rescue._id, answer: "Offer no more than 5 percent." });
    expect((await harness.run((ctx) => ctx.db.get(rescue._id)))?.state).toBe("sending");
  });

  it("delivers an owner's approved rescue answer through the authorized dispatch path", async () => {
    const harness = createHarness();
    const source = await aiTenant(harness, "owner-rescue-delivery");
    const systemPrompt = "You represent Owner Rescue Delivery, a Nigerian retail business. Answer only with verified business facts, never invent prices, availability, delivery promises, discounts, payment confirmation, or policies, and write concise natural WhatsApp replies.";
    await source.owner.mutation(api.businessProfile.save, { businessId: source.businessId, systemPrompt, customerAutoReplyEnabled: true, groupAutoReplyEnabled: false });
    const request = await directInteraction(harness, source, "Can you give me your last price?");
    await harness.mutation(internal.commerceIntelligence.createGenerationRescue, { interactionId: request.interactionId, reason: "discount_approval", question: "What discount can Pipelixr offer?", holdingReply: "Let me confirm the best approved price for you." });
    const [rescue] = await harness.run((ctx) => ctx.db.query("ownerRescueRequests").collect());
    vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
    vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
    vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-provider-key");
    vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
    vi.stubEnv("GROQ_LLM_MODEL", "synthetic-model");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://api.groq.com/openai/v1/chat/completions") return Response.json({ choices: [{ message: { content: "I can offer up to 5 percent off for you." } }] });
      if (url.endsWith("/message/presence")) return Response.json({ message: "success" });
      if (url.endsWith("/send/text")) return Response.json({ message: { id: "owner-rescue-message" } });
      throw new Error(`Unexpected request: ${url}`);
    }));

    await source.owner.mutation(api.commerceIntelligence.answerRescue, { businessId: source.businessId, rescueId: rescue._id, answer: "Offer no more than 5 percent." });
    await harness.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(await harness.run((ctx) => ctx.db.get(rescue._id))).toMatchObject({ state: "answered", ownerAnswer: "Offer no more than 5 percent." });
    const dispatches = await harness.run((ctx) => ctx.db.query("assistantDispatches").collect());
    expect(dispatches).toEqual([expect.objectContaining({ state: "accepted", kind: "owner_rescue", ownerRescueId: rescue._id, content: "I can offer up to 5 percent off for you." })]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("reopens an owner rescue when customer-reply consent is revoked before delivery", async () => {
    const harness = createHarness();
    const source = await aiTenant(harness, "owner-rescue-revoked");
    const systemPrompt = "You represent Owner Rescue Revoked, a Nigerian retail business. Answer only with verified business facts, never invent prices, availability, delivery promises, discounts, payment confirmation, or policies, and write concise natural WhatsApp replies.";
    await source.owner.mutation(api.businessProfile.save, { businessId: source.businessId, systemPrompt, customerAutoReplyEnabled: true, groupAutoReplyEnabled: false });
    const request = await directInteraction(harness, source, "Is delivery available tomorrow?");
    await harness.mutation(internal.commerceIntelligence.createGenerationRescue, { interactionId: request.interactionId, reason: "missing_fact", question: "What delivery promise is approved?", holdingReply: "Let me confirm delivery for you." });
    const [rescue] = await harness.run((ctx) => ctx.db.query("ownerRescueRequests").collect());
    await source.owner.mutation(api.commerceIntelligence.answerRescue, { businessId: source.businessId, rescueId: rescue._id, answer: "Delivery is available on Friday only." });
    await source.owner.mutation(api.businessProfile.save, { businessId: source.businessId, systemPrompt, customerAutoReplyEnabled: false, groupAutoReplyEnabled: false });
    await harness.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await harness.run((ctx) => ctx.db.get(rescue._id))).toMatchObject({ state: "open", ownerAnswer: "Delivery is available on Friday only.", deliveryError: expect.stringContaining("authorization") });
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toEqual([]);
  });

  it("lets the owner safely resolve an uncertain rescue delivery after checking WhatsApp", async () => {
    const harness = createHarness();
    const source = await aiTenant(harness, "owner-rescue-unknown");
    const request = await directInteraction(harness, source, "Can this arrive today?");
    await harness.mutation(internal.commerceIntelligence.createGenerationRescue, { interactionId: request.interactionId, reason: "missing_fact", question: "What delivery answer is approved?", holdingReply: "Let me confirm that for you." });
    const [rescue] = await harness.run((ctx) => ctx.db.query("ownerRescueRequests").collect());
    await harness.run((ctx) => ctx.db.patch(rescue._id, { state: "delivery_unknown", ownerAnswer: "Delivery is available tomorrow.", deliveryError: "Check WhatsApp.", updatedAt: Date.now() }));
    await source.owner.mutation(api.commerceIntelligence.resolveRescueDelivery, { businessId: source.businessId, rescueId: rescue._id, decision: "not_delivered" });
    expect(await harness.run((ctx) => ctx.db.get(rescue._id))).toMatchObject({ state: "open", ownerAnswer: "Delivery is available tomorrow.", deliveryError: expect.stringContaining("safely send it again") });
    await harness.run((ctx) => ctx.db.patch(rescue._id, { state: "delivery_unknown", updatedAt: Date.now() }));
    await source.owner.mutation(api.commerceIntelligence.resolveRescueDelivery, { businessId: source.businessId, rescueId: rescue._id, decision: "delivered" });
    expect(await harness.run((ctx) => ctx.db.get(rescue._id))).toMatchObject({ state: "answered", answeredAt: expect.any(Number) });
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
