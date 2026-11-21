import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { createHarness, tenant, type Harness } from "./harness";

let fixtureCounter = 0;

async function interaction(harness: Harness, source: Awaited<ReturnType<typeof tenant>>, conversation?: { customerId: any; conversationId: any }, content = "I want to buy") {
  fixtureCounter += 1;
  const suffix = String(fixtureCounter).padStart(8, "0");
  return await harness.run(async (ctx) => {
    const now = Date.now() + fixtureCounter;
    const customerId = conversation?.customerId ?? await ctx.db.insert("customers", { businessId: source.businessId, phone: `2347${suffix}@s.whatsapp.net`, identityKey: `qualification-${suffix}`, name: "Qualification buyer", totalValue: 0, lastInteraction: now, isGroup: false, tags: ["captured"] });
    const conversationId = conversation?.conversationId ?? await ctx.db.insert("conversations", { businessId: source.businessId, customerId, identityKey: `qualification-${suffix}`, revision: 1, lastEventAt: now, messageCount: 1 });
    const interactionId = await ctx.db.insert("interactions", { businessId: source.businessId, customerId, conversationId, sessionId: source.sessionId, role: "customer", content, timestamp: now, receivedAt: now, messageType: "text", manualReviewRequired: false, isGroup: false });
    return { customerId, conversationId, interactionId };
  });
}

describe("automatic lead qualification", () => {
  it("lets each business define its qualification requirements", async () => {
    const harness = createHarness();
    const first = await tenant(harness, "qualification-policy-first");
    const second = await tenant(harness, "qualification-policy-second");
    const defaults = await first.owner.query(api.leadQualification.policy, { businessId: first.businessId });
    expect(defaults).toMatchObject({ enabled: true, requiredFields: ["need", "location", "timeline", "budget", "readiness"] });
    await first.owner.mutation(api.leadQualification.savePolicy, { businessId: first.businessId, enabled: true, criteria: "A good lead needs corporate catering in Lagos within thirty days and is ready to confirm a workable budget.", requiredFields: ["need", "location", "timeline", "budget"] });
    expect(await first.owner.query(api.leadQualification.policy, { businessId: first.businessId })).toMatchObject({ enabled: true, requiredFields: ["need", "location", "timeline", "budget"] });
    await expect(second.owner.query(api.leadQualification.policy, { businessId: first.businessId })).rejects.toThrow();
  });

  it("accumulates confirmed answers and qualifies the lead automatically", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "qualification-lifecycle");
    await source.owner.mutation(api.leadQualification.savePolicy, { businessId: source.businessId, enabled: true, criteria: "A qualified buyer wants catering in Lagos, has a workable budget, needs it within a month, and is ready to book.", requiredFields: ["need", "location", "timeline", "budget", "readiness"] });
    const first = await interaction(harness, source, undefined, "I need catering for an office event in Lagos.");
    const firstState = await harness.mutation(internal.leadQualification.applyAssessment, {
      interactionId: first.interactionId,
      salesIntent: true,
      optOut: false,
      answers: [{ field: "need", value: "Office event catering", confidence: 0.95 }, { field: "location", value: "Lagos", confidence: 0.98 }],
      fit: "uncertain",
      fitConfidence: 0.5,
      fitReason: "Need and service area fit, but buying details are still missing.",
    });
    expect(firstState).toMatchObject({ status: "qualifying", score: 43, missingFields: ["timeline", "budget", "readiness"] });

    const second = await interaction(harness, source, first, "Next Friday, budget is NGN 250,000 and I am ready to book.");
    const completed = await harness.mutation(internal.leadQualification.applyAssessment, {
      interactionId: second.interactionId,
      salesIntent: true,
      optOut: false,
      answers: [{ field: "timeline", value: "Next Friday", confidence: 0.97 }, { field: "budget", value: "NGN 250,000", confidence: 0.96 }, { field: "readiness", value: "Ready to book", confidence: 0.98 }],
      fit: "fit",
      fitConfidence: 0.94,
      fitReason: "The customer meets the stated need, service area, budget, timeline, and readiness requirements.",
    });
    expect(completed).toMatchObject({ status: "qualified", score: 100, missingFields: [] });
    const [qualification] = await harness.run((ctx) => ctx.db.query("leadQualifications").collect());
    expect(qualification).toMatchObject({ status: "qualified", score: 100, qualifiedAt: expect.any(Number) });
    const [outcome] = await harness.run((ctx) => ctx.db.query("conversationOutcomes").collect());
    expect(outcome).toMatchObject({ outcome: "qualified", recordedBy: "system", decisiveInteractionId: second.interactionId });
    expect(await source.owner.query(api.leadQualification.insights, { businessId: source.businessId })).toMatchObject({ active: 0, qualified: 1, averageScore: 100 });
  });

  it("records only questions actually sent and stops repeating them", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "qualification-question-attempts");
    await source.owner.mutation(api.leadQualification.savePolicy, { businessId: source.businessId, enabled: true, criteria: "A lead must explain what they need and when they need it.", requiredFields: ["need", "timeline"] });
    const first = await interaction(harness, source, undefined, "I want your service.");
    const initial = await harness.mutation(internal.leadQualification.applyAssessment, { interactionId: first.interactionId, salesIntent: true, optOut: false, answers: [], fit: "uncertain", fitConfidence: 0.3, fitReason: "No qualification details are confirmed." });
    expect(initial?.nextQuestionField).toBe("need");
    await harness.mutation(internal.leadQualification.recordQuestionAsked, { conversationId: first.conversationId, field: "need", askedAt: Date.now() });
    const second = await interaction(harness, source, first, "Can you tell me the price first?");
    const next = await harness.mutation(internal.leadQualification.applyAssessment, { interactionId: second.interactionId, salesIntent: true, optOut: false, answers: [], fit: "uncertain", fitConfidence: 0.3, fitReason: "The customer has not answered yet." });
    expect(next?.nextQuestionField).toBe("timeline");
  });

  it("honors a customer opting out and asks no further question", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "qualification-optout");
    const first = await interaction(harness, source, undefined, "Please stop asking, I am not interested.");
    const state = await harness.mutation(internal.leadQualification.applyAssessment, { interactionId: first.interactionId, salesIntent: false, optOut: true, answers: [], fit: "not_fit", fitConfidence: 1, fitReason: "The customer opted out." });
    expect(state).toMatchObject({ status: "opted_out", nextQuestionField: null });
    expect(await source.owner.query(api.leadQualification.insights, { businessId: source.businessId })).toMatchObject({ optedOut: 1, qualified: 0 });
  });

  it("saves business AI authorization and qualification controls together", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "qualification-profile-save");
    const systemPrompt = "You represent Qualification Profile Save, a Lagos catering business. Answer only with verified facts, ask concise questions naturally, never invent prices, availability, delivery details, payment confirmation, discounts, or policies, and escalate anything uncertain to the business owner.";
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt,
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
      leadQualificationEnabled: true,
      leadQualificationCriteria: "A qualified lead needs catering within Lagos, has a workable event budget, a confirmed event date, and is ready to book.",
      leadQualificationRequiredFields: ["need", "location", "timeline", "budget", "readiness"],
    });
    expect(await source.owner.query(api.businessProfile.get, { businessId: source.businessId })).toMatchObject({ systemPrompt, customerAutoReplyEnabled: true });
    expect(await source.owner.query(api.leadQualification.policy, { businessId: source.businessId })).toMatchObject({ enabled: true, criteria: expect.stringContaining("qualified lead"), requiredFields: ["need", "location", "timeline", "budget", "readiness"] });
  });
});
