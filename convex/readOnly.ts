import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireBusiness, requireIdentity } from "./lib/authorization";
import { CLASSIFIER_VERSION, evaluateClassifier, type LabeledExample, type MessageClass } from "./lib/classifier";
import type { Id } from "./_generated/dataModel";
import { createForMissedOpportunity } from "./followUps";

const messageClass = v.union(v.literal("buying_signal"), v.literal("inquiry"), v.literal("payment_related"), v.literal("casual_noise"), v.literal("manual_review"));
type ReportRow = { opportunityId: Id<"missedRevenueOpportunities">; interactionId: Id<"interactions">; customerId: Id<"customers">; customerName: string; identity: string; message: string; triggerAt: number; dueAt: number; responseWindowMinutes: number; classifierVersion: string; classifierConfidence: number; ruleIds: string[] };
type LabelQueueRow = { interactionId: Id<"interactions">; customerId: Id<"customers">; customerName: string; message: string; timestamp: number; messageType: string; prediction: MessageClass; confidence: number; ruleIds: string[]; classifierVersion: string; humanLabel: MessageClass | null };

export const promoteOpportunity = internalMutation({
  args: { opportunityId: v.id("missedRevenueOpportunities") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity || opportunity.state !== "pending" || opportunity.dueAt > Date.now()) return null;
    const conversation = await ctx.db.get(opportunity.conversationId);
    const interaction = await ctx.db.get(opportunity.interactionId);
    const customer = await ctx.db.get(opportunity.customerId);
    // Missing, expired, deleted, or cross-linked evidence is closed rather than
    // reported. The report never reconstructs content from denormalized fields.
    if (!conversation || !interaction || !customer || customer.deletedAt !== undefined || conversation.businessId !== opportunity.businessId || interaction.businessId !== opportunity.businessId || interaction.role !== "customer" || interaction.timestamp !== opportunity.triggerAt || (conversation.lastOwnerAt ?? 0) >= opportunity.triggerAt) {
      await ctx.db.patch(opportunity._id, { state: "answered", ...((conversation?.lastOwnerAt ?? 0) >= opportunity.triggerAt ? { answeredAt: conversation?.lastOwnerAt } : {}) });
      return null;
    }
    await ctx.db.patch(opportunity._id, { state: "missed" });
    await createForMissedOpportunity(ctx, opportunity._id);
    return null;
  },
});

export const missedRevenueReport = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ opportunityId: v.id("missedRevenueOpportunities"), interactionId: v.id("interactions"), customerId: v.id("customers"), customerName: v.string(), identity: v.string(), message: v.string(), triggerAt: v.number(), dueAt: v.number(), responseWindowMinutes: v.number(), classifierVersion: v.string(), classifierConfidence: v.number(), ruleIds: v.array(v.string()) })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const opportunities = await ctx.db.query("missedRevenueOpportunities").withIndex("by_business_state_due", (builder) => builder.eq("businessId", args.businessId).eq("state", "missed")).order("desc").take(100);
    const report: ReportRow[] = [];
    for (const opportunity of opportunities) {
      const interaction = await ctx.db.get(opportunity.interactionId);
      const customer = await ctx.db.get(opportunity.customerId);
      if (!interaction || !customer || interaction.businessId !== args.businessId || customer.businessId !== args.businessId || customer.deletedAt !== undefined) continue;
      report.push({ opportunityId: opportunity._id, interactionId: interaction._id, customerId: customer._id, customerName: customer.name ?? "Unnamed customer", identity: customer.phone, message: interaction.content, triggerAt: opportunity.triggerAt, dueAt: opportunity.dueAt, responseWindowMinutes: opportunity.responseWindowMinutes, classifierVersion: opportunity.classifierVersion, classifierConfidence: opportunity.classifierConfidence, ruleIds: opportunity.ruleIds });
    }
    return report;
  },
});

export const labelQueue = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ interactionId: v.id("interactions"), customerId: v.id("customers"), customerName: v.string(), message: v.string(), timestamp: v.number(), messageType: v.string(), prediction: messageClass, confidence: v.number(), ruleIds: v.array(v.string()), classifierVersion: v.string(), humanLabel: v.union(messageClass, v.null()) })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const interactions = await ctx.db.query("interactions").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(100);
    const output: LabelQueueRow[] = [];
    for (const interaction of interactions) {
      if (interaction.role !== "customer" || !interaction.classifierLabel || !interaction.classifierVersion) continue;
      const customer = await ctx.db.get(interaction.customerId);
      if (!customer || customer.businessId !== args.businessId || customer.deletedAt !== undefined) continue;
      const label = await ctx.db.query("messageLabels").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).unique();
      output.push({ interactionId: interaction._id, customerId: customer._id, customerName: customer.name ?? "Unnamed customer", message: interaction.content, timestamp: interaction.timestamp, messageType: interaction.messageType ?? "unsupported", prediction: interaction.classifierLabel, confidence: interaction.classifierConfidence ?? 0, ruleIds: interaction.classifierRuleIds ?? [], classifierVersion: interaction.classifierVersion, humanLabel: label?.label ?? null });
      if (output.length === 50) break;
    }
    return output;
  },
});

export const setLabel = mutation({
  args: { businessId: v.id("businesses"), interactionId: v.id("interactions"), label: messageClass },
  returns: v.id("messageLabels"),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const identity = await requireIdentity(ctx);
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.businessId !== args.businessId || interaction.role !== "customer") throw new ConvexError({ code: "NOT_FOUND" });
    const customer = await ctx.db.get(interaction.customerId);
    if (!customer || customer.businessId !== args.businessId || customer.deletedAt !== undefined) throw new ConvexError({ code: "NOT_FOUND" });
    const existing = await ctx.db.query("messageLabels").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).unique();
    const values = { businessId: args.businessId, customerId: customer._id, interactionId: interaction._id, label: args.label, labeledBy: identity.subject, labeledAt: Date.now() };
    if (existing) { await ctx.db.patch(existing._id, values); return existing._id; }
    return await ctx.db.insert("messageLabels", values);
  },
});

export const setResponseWindow = mutation({
  args: { businessId: v.id("businesses"), responseWindowMinutes: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    if (!Number.isSafeInteger(args.responseWindowMinutes) || args.responseWindowMinutes < 15 || args.responseWindowMinutes > 1440) throw new ConvexError({ code: "INVALID_RESPONSE_WINDOW" });
    // This setting affects only future candidates. Existing opportunities keep
    // their stored snapshot so report deadlines remain explainable and stable.
    await ctx.db.patch(args.businessId, { responseWindowMinutes: args.responseWindowMinutes });
    return null;
  },
});

export const evaluation = query({
  args: { businessId: v.id("businesses") },
  returns: v.object({ version: v.string(), samples: v.number(), truePositive: v.number(), falsePositive: v.number(), falseNegative: v.number(), precision: v.number(), recall: v.number(), f1: v.number(), accuracy: v.number() }),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const labels = await ctx.db.query("messageLabels").withIndex("by_business_time", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(500);
    const examples: LabeledExample[] = [];
    for (const label of labels) {
      const interaction = await ctx.db.get(label.interactionId);
      if (!interaction || interaction.businessId !== args.businessId || interaction.role !== "customer") continue;
      examples.push({ text: interaction.content, label: label.label as MessageClass, mediaType: interaction.messageType ?? "unsupported", manualReview: interaction.manualReviewRequired ?? false });
    }
    const result = evaluateClassifier(examples);
    return { version: CLASSIFIER_VERSION, samples: result.samples, truePositive: result.truePositive, falsePositive: result.falsePositive, falseNegative: result.falseNegative, precision: result.precision, recall: result.recall, f1: result.f1, accuracy: result.accuracy };
  },
});
