import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getBusiness = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("businesses")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .first();
  },
});

export const getBusinessById = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => ctx.db.get(args.businessId),
});

export const getBusinessByEvolutionInstanceName = query({
  args: { instanceName: v.string() },
  handler: async (ctx, args) => {
    const businesses = await ctx.db.query("businesses").collect();
    return businesses.find((business) => 
      business.evolutionInstanceName === args.instanceName || 
      business.evolutionInstanceId === args.instanceName ||
      business.name === args.instanceName ||
      // Sometimes Evolution Go sends "My Business" etc. with whitespace differences
      business.name?.trim().toLowerCase() === args.instanceName.trim().toLowerCase()
    ) || null;
  },
});

export const createOrUpdateBusiness = mutation({
  args: {
    name: v.string(),
    ownerId: v.string(),
    onboardingStep: v.number(),
    whatsappMode: v.optional(v.union(v.literal("official"), v.literal("unofficial"))),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("businesses")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .first();

    if (existing) {
      const shouldAdoptName = !existing.name || existing.name === "My Business";
      await ctx.db.patch(existing._id, {
        onboardingStep: args.onboardingStep,
        whatsappMode: args.whatsappMode ?? existing.whatsappMode,
        ...(shouldAdoptName ? { name: args.name } : {}),
      });
      return existing._id;
    } else {
      return await ctx.db.insert("businesses", {
        name: args.name,
        ownerId: args.ownerId,
        onboardingStep: args.onboardingStep,
        whatsappStatus: "disconnected",
        whatsappMode: args.whatsappMode,
      });
    }
  },
});

export const updateConnectionStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    status: v.union(v.literal("disconnected"), v.literal("connected"), v.literal("error"), v.literal("pending")),
    connectionDetails: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.businessId, {
      whatsappStatus: args.status,
      connectionDetails: args.connectionDetails,
    });
  },
});

export const updateBusinessDetails = mutation({
  args: {
    businessId: v.id("businesses"),
    name: v.optional(v.string()),
    industry: v.optional(v.string()),
    averageOrderValue: v.optional(v.number()),
    responseWindowMinutes: v.optional(v.number()),
    followUpTemplate: v.optional(v.string()),
    // AI Behaviour — plain-language settings the owner controls from Settings → AI Behavior.
    aiEnabled: v.optional(v.boolean()),
    aiTone: v.optional(v.union(v.literal("friendly"), v.literal("professional"), v.literal("playful"))),
    aiLanguageStyle: v.optional(v.union(v.literal("english"), v.literal("pidgin"), v.literal("mixed"))),
    aiBusinessContext: v.optional(v.string()),
    aiWorkHoursEnabled: v.optional(v.boolean()),
    aiWorkHoursStart: v.optional(v.number()),
    aiWorkHoursEnd: v.optional(v.number()),
    aiNeverQuotePrice: v.optional(v.boolean()),
    aiNeverSendPaymentLink: v.optional(v.boolean()),
    aiNeverOfferDiscount: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // PRD: Response window must be between 30 minutes and 1440 minutes (24 hours)
    if (args.responseWindowMinutes !== undefined) {
      if (args.responseWindowMinutes < 30 || args.responseWindowMinutes > 1440) {
        throw new Error("Response window must be between 30 minutes and 24 hours (1440 minutes).");
      }
    }
    // Guard: business context free-text should not be arbitrarily long. Keep it
    // short enough that we can safely inject it into every system prompt.
    if (args.aiBusinessContext !== undefined && args.aiBusinessContext.length > 500) {
      throw new Error("Business context must be 500 characters or fewer.");
    }
    // Guard: work-hours window must be a valid minutes-since-midnight range.
    for (const field of ["aiWorkHoursStart", "aiWorkHoursEnd"] as const) {
      const val = args[field];
      if (val !== undefined && (val < 0 || val > 24 * 60)) {
        throw new Error(`${field} must be between 0 and 1440 minutes.`);
      }
    }
    const { businessId, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(businessId, filtered);
  },
});


export const setEvolutionInstance = mutation({
  args: {
    businessId: v.id("businesses"),
    instanceName: v.string(),
    instanceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.businessId, {
      evolutionInstanceName: args.instanceName,
      ...(args.instanceId ? { evolutionInstanceId: args.instanceId } : {}),
    });
  },
});
