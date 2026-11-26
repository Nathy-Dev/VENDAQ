import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { aiTenant, createHarness, drain, tenant } from "./harness";

async function seedInteraction(harness: ReturnType<typeof createHarness>, source: Awaited<ReturnType<typeof tenant>>, options: { group?: boolean; content?: string; label?: "buying_signal" | "inquiry" | "payment_related"; participantJid?: string } = {}) {
  return await harness.run(async (ctx) => {
    const phone = options.group ? "120000000111@g.us" : "2348000000111@s.whatsapp.net";
    const customerId = await ctx.db.insert("customers", { businessId: source.businessId, phone, identityKey: `identity-${phone}`, name: options.group ? "Retail Community" : "Amaka", totalValue: 0, lastInteraction: Date.now(), isGroup: options.group ?? false, tags: options.group ? ["group"] : ["captured"] });
    const conversationId = await ctx.db.insert("conversations", { businessId: source.businessId, customerId, identityKey: `identity-${phone}`, revision: 1, lastEventAt: Date.now(), lastInboundAt: Date.now(), messageCount: 1 });
    const interactionId = await ctx.db.insert("interactions", { businessId: source.businessId, customerId, conversationId, sessionId: source.sessionId, aiProcessingEpoch: (await ctx.db.get(source.businessId))?.aiProcessingEpoch, role: "customer", content: options.content ?? "How much is the blue one?", timestamp: Date.now(), messageType: "text", manualReviewRequired: false, isGroup: options.group ?? false, classifierLabel: options.label ?? "buying_signal", classifierVersion: "test", classifierConfidence: 0.92, classifierRuleIds: ["test"], ...(options.participantJid ? { participantJid: options.participantJid, participantName: "Ada" } : {}) });
    return { customerId, conversationId, interactionId, phone };
  });
}

describe("community opportunity engine", () => {
  it("captures enabled-group evidence once and attributes recorded revenue to the source group", async () => {
    const harness = createHarness();
    const source = await aiTenant(harness, "community-revenue");
    const seeded = await seedInteraction(harness, source, { group: true, participantJid: "2348111111111@s.whatsapp.net" });
    await harness.mutation(internal.groups.upsertFromProvider, { businessId: source.businessId, groups: [{ jid: seeded.phone, name: "Retail Community", memberCount: 50, role: "admin" }] });
    await harness.run(async (ctx) => { const group = await ctx.db.query("managedGroups").withIndex("by_business_group", (q) => q.eq("businessId", source.businessId).eq("groupJid", seeded.phone)).unique(); await ctx.db.patch(group!._id, { isEnabled: true, allowPrivateHandoff: true }); });
    const first = await harness.mutation(internal.communityEngine.captureFromInteraction, { interactionId: seeded.interactionId });
    const duplicate = await harness.mutation(internal.communityEngine.captureFromInteraction, { interactionId: seeded.interactionId });
    expect(duplicate).toBe(first);
    const [opportunity] = await source.owner.query(api.communityEngine.list, { businessId: source.businessId });
    expect(opportunity).toMatchObject({ sourceType: "group", sourceName: "Retail Community", privateHandoffState: "suggested" });
    await source.owner.mutation(api.communityEngine.recordOutcome, { businessId: source.businessId, opportunityId: opportunity.opportunityId, outcome: "won", value: 25000 });
    const insights = await source.owner.query(api.communityEngine.insights, { businessId: source.businessId });
    expect(insights.groupRevenue).toBe(25000);
    expect(insights.topGroups[0]).toMatchObject({ groupName: "Retail Community", revenue: 25000 });
  });

  it("requires explicit group consent before a private handoff can be completed", async () => {
    const harness = createHarness();
    const source = await aiTenant(harness, "handoff-consent");
    const seeded = await seedInteraction(harness, source, { group: true, participantJid: "2348222222222@s.whatsapp.net" });
    await harness.mutation(internal.groups.upsertFromProvider, { businessId: source.businessId, groups: [{ jid: seeded.phone, name: "Owners Circle", memberCount: 30, role: "owner" }] });
    await harness.run(async (ctx) => { const group = await ctx.db.query("managedGroups").withIndex("by_business_group", (q) => q.eq("businessId", source.businessId).eq("groupJid", seeded.phone)).unique(); await ctx.db.patch(group!._id, { isEnabled: true, allowPrivateHandoff: true }); });
    const opportunityId = await harness.mutation(internal.communityEngine.captureFromInteraction, { interactionId: seeded.interactionId });
    await expect(source.owner.mutation(api.communityEngine.setPrivateHandoff, { businessId: source.businessId, opportunityId: opportunityId!, state: "completed" })).rejects.toThrow("HANDOFF_CONSENT_REQUIRED");
    const consentInteractionId = await harness.run((ctx) => ctx.db.insert("interactions", {
      businessId: source.businessId, customerId: seeded.customerId, conversationId: seeded.conversationId, sessionId: source.sessionId,
      role: "customer", content: "Yes, you can message me privately", timestamp: Date.now() + 1_000, messageType: "text",
      manualReviewRequired: false, isGroup: true, participantJid: "2348222222222@s.whatsapp.net", participantName: "Ada",
    }));
    await source.owner.mutation(api.communityEngine.setPrivateHandoff, { businessId: source.businessId, opportunityId: opportunityId!, state: "consented", consentInteractionId });
    await source.owner.mutation(api.communityEngine.setPrivateHandoff, { businessId: source.businessId, opportunityId: opportunityId!, state: "completed" });
    expect(await harness.run((ctx) => ctx.db.query("handoffEvents").withIndex("by_opportunity_time", (q) => q.eq("opportunityId", opportunityId!)).collect())).toHaveLength(2);
    await source.owner.mutation(api.foundation.deleteCustomer, { businessId: source.businessId, customerId: seeded.customerId });
    await drain(harness);
    expect(await harness.run((ctx) => ctx.db.query("handoffEvents").collect())).toHaveLength(0);
    expect(await harness.run((ctx) => ctx.db.query("communityOpportunities").collect())).toHaveLength(0);
  });

  it("returns no private-handoff consent choices for direct-chat opportunities", async () => {
    const harness = createHarness();
    const source = await aiTenant(harness, "direct-handoff");
    const seeded = await seedInteraction(harness, source);
    const opportunityId = await harness.mutation(internal.communityEngine.captureFromInteraction, { interactionId: seeded.interactionId });
    expect(await source.owner.query(api.communityEngine.handoffConsentCandidates, { businessId: source.businessId, opportunityId: opportunityId! })).toEqual([]);
  });

  it("adds knowledge only after the owner supplies and approves a verified answer", async () => {
    const harness = createHarness();
    const source = await aiTenant(harness, "knowledge-approval");
    const prompt = "You represent Knowledge Approval, a Nigerian retail business. Answer only with verified facts, never invent prices, stock, delivery details, payment information, or policies, and ask one short clarifying question whenever information is missing.";
    await source.owner.mutation(api.businessProfile.save, { businessId: source.businessId, systemPrompt: prompt, customerAutoReplyEnabled: false, groupAutoReplyEnabled: false, assistantSettingsVersion: 2 });
    const seeded = await seedInteraction(harness, source, { content: "Do you deliver to Enugu?", label: "inquiry" });
    await harness.mutation(internal.communityEngine.captureFromInteraction, { interactionId: seeded.interactionId });
    const [suggestion] = await source.owner.query(api.communityEngine.knowledge, { businessId: source.businessId });
    await expect(source.owner.mutation(api.communityEngine.reviewKnowledge, { businessId: source.businessId, suggestionId: suggestion.suggestionId, decision: "approved", answer: "Yes" })).rejects.toThrow("VERIFIED_ANSWER_REQUIRED");
    await source.owner.mutation(api.communityEngine.reviewKnowledge, { businessId: source.businessId, suggestionId: suggestion.suggestionId, decision: "approved", answer: "We deliver to Enugu within three working days after payment is confirmed." });
    const profile = await source.owner.query(api.businessProfile.get, { businessId: source.businessId });
    expect(profile.systemPrompt).toContain("We deliver to Enugu within three working days");
  });

  it("refuses cross-tenant opportunity changes", async () => {
    const harness = createHarness();
    const first = await aiTenant(harness, "opportunity-owner");
    const second = await tenant(harness, "opportunity-attacker");
    const seeded = await seedInteraction(harness, first);
    const opportunityId = await harness.mutation(internal.communityEngine.captureFromInteraction, { interactionId: seeded.interactionId });
    await expect(second.owner.mutation(api.communityEngine.update, { businessId: second.businessId, opportunityId: opportunityId!, state: "won" })).rejects.toThrow("NOT_FOUND");
  });
});
