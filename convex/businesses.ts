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
    return businesses.find((business) => business.evolutionInstanceName === args.instanceName) || null;
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
  },
  handler: async (ctx, args) => {
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
