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
      await ctx.db.patch(existing._id, {
        onboardingStep: args.onboardingStep,
        whatsappMode: args.whatsappMode ?? existing.whatsappMode,
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
    status: v.union(v.literal("disconnected"), v.literal("connected"), v.literal("error")),
    connectionDetails: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.businessId, {
      whatsappStatus: args.status,
      connectionDetails: args.connectionDetails,
    });
  },
});
