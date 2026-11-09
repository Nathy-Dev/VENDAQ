import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireBusiness } from "./lib/authorization";
import { foundationPolicy } from "./lib/policy";

export const settings = query({
  args: { businessId: v.id("businesses") },
  returns: v.object({ statusViewerListEnabled: v.boolean(), automatedSendingRequested: v.boolean(), automatedSendingAvailable: v.boolean(), unavailableReason: v.string() }),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId);
    return { statusViewerListEnabled: business.statusViewerListEnabled ?? false, automatedSendingRequested: business.automatedSendingRequested ?? false, automatedSendingAvailable: false, unavailableReason: "Evolution Go send idempotency and timeout reconciliation are not qualified, so automated sending remains blocked." };
  },
});

export const updateSettings = mutation({
  args: { businessId: v.id("businesses"), statusViewerListEnabled: v.boolean(), automatedSendingRequested: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    // The request records product interest only. It never enables dispatch.
    await ctx.db.patch(args.businessId, { statusViewerListEnabled: args.statusViewerListEnabled, automatedSendingRequested: args.automatedSendingRequested });
    return null;
  },
});

export const statusViewers = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ observationId: v.id("statusObservations"), statusMessageId: v.string(), opaqueViewerKey: v.string(), observedAt: v.number() })),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId);
    if (!business.statusViewerListEnabled) return [];
    const observations = await ctx.db.query("statusObservations").withIndex("by_business_time", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(100);
    // Identity keys are deployment-keyed hashes. Never expose or infer a phone.
    return observations.map((entry) => ({ observationId: entry._id, statusMessageId: entry.statusMessageId, opaqueViewerKey: entry.viewerIdentityKey, observedAt: entry.observedAt }));
  },
});

export const readiness = query({
  args: { businessId: v.id("businesses") },
  returns: v.object({ connectionState: v.string(), killSwitch: v.boolean(), recentRiskEvents: v.number(), warning: v.boolean(), dispatchQualified: v.boolean(), reasons: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId);
    const policy = foundationPolicy();
    const since = Date.now() - policy.riskWindowHours * 3600000;
    const [session, audits, failures] = await Promise.all([
      ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).unique(),
      ctx.db.query("foundationAudit").withIndex("by_business_time", (builder) => builder.eq("businessId", args.businessId).gte("at", since)).take(policy.dashboardRecordLimit),
      ctx.db.query("inboundEvents").withIndex("by_business_state", (builder) => builder.eq("businessId", args.businessId).eq("state", "dead_letter").gte("receivedAt", since)).take(policy.dashboardRecordLimit),
    ]);
    const recentRiskEvents = audits.filter((entry) => entry.kind.includes("dead_letter") || entry.code !== undefined).length + failures.length + (session?.lastError ? 1 : 0);
    const reasons = ["Provider send idempotency is unqualified.", "Provider timeout reconciliation is unqualified."];
    if (business.killSwitch ?? true) reasons.push("The business kill switch is active.");
    if (session?.state !== "connected") reasons.push("The WhatsApp session is not connected.");
    if (recentRiskEvents >= policy.riskWarningCount) reasons.push(`Recent provider or processing risk events reached ${recentRiskEvents}.`);
    return { connectionState: session?.state ?? "disconnected", killSwitch: business.killSwitch ?? true, recentRiskEvents, warning: recentRiskEvents >= policy.riskWarningCount, dispatchQualified: false, reasons };
  },
});
