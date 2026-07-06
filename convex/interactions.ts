import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";

export const getChatMessages = query({
  args: { 
    businessId: v.id("businesses"),
    customerId: v.id("customers")
  },
  handler: async (ctx, args) => {
    console.log(`[Convex] Fetching messages for customer ${args.customerId} in business ${args.businessId}`);
    return await ctx.db
      .query("interactions")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .filter(q => q.eq(q.field("businessId"), args.businessId))
      .order("asc")
      .collect();
  },
});

export const getRecentChats = query({
    args: { businessId: v.id("businesses") },
    handler: async (ctx, args) => {
      const recentWindowHours = Number(process.env.RECENT_CHATS_WINDOW_HOURS || 24);
      const cutoffMs = Date.now() - recentWindowHours * 60 * 60 * 1000;

      // 1. Get recently active customers only
      const customers = await ctx.db
        .query("customers")
        .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
        .filter((q) => q.gte(q.field("lastInteraction"), cutoffMs))
        .order("desc")
        .take(100);

      const results: (Doc<"customers"> & {
        lastMessage: string;
        lastMessageTimestamp: number;
        lastMessageType?: "text" | "image" | "video" | "audio" | "document" | "location";
        lastMediaId?: string;
        lastIntent?: string;
      })[] = [];
      for (const customer of customers) {
        // 2. Fetch only the ONE most recent message for this specific customer
        const lastInteraction = await ctx.db
          .query("interactions")
          .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
          .filter((q) => q.gte(q.field("timestamp"), cutoffMs))
          .order("desc")
          .first();

        // Only include records with real recent interactions.
        if (!lastInteraction) continue;

        results.push({
          ...customer,
          lastMessage: lastInteraction.content,
          lastMessageTimestamp: lastInteraction.timestamp,
          lastMessageType: lastInteraction.messageType,
          lastMediaId: lastInteraction.mediaId,
          lastIntent: lastInteraction.intent || customer.lastIntent,
        });
      }

      return results;
    },
});

export const getMediaUrl = query({
  args: { mediaId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.mediaId);
  },
});

// Dedicated mutation to update a customer's display name without creating fake messages
export const updateCustomerName = mutation({
  args: {
    businessId: v.id("businesses"),
    phone: v.string(),
    name: v.string(),
    isGroup: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_business_phone", (q) =>
        q.eq("businessId", args.businessId).eq("phone", args.phone)
      )
      .unique();

    if (customer) {
      // Only update if the new name is better than the existing one
      const isCurrentNameBad = !customer.name || customer.name === customer.phone || customer.name.includes('@');
      const isNewNameGood = args.name && !args.name.includes('@') && args.name !== args.phone;

      if (isCurrentNameBad && isNewNameGood) {
        await ctx.db.patch(customer._id, { name: args.name });
      }
    } else {
      // Create the customer record with the known name
      await ctx.db.insert("customers", {
        businessId: args.businessId,
        phone: args.phone,
        name: args.name,
        isGroup: args.isGroup,
        totalValue: 0,
        lastInteraction: Date.now(),
        tags: [args.isGroup ? "group" : "contact"],
      });
    }
  },
});

export const getCustomerById = query({
  args: { 
    businessId: v.id("businesses"),
    customerId: v.id("customers")
  },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId) return null;
    return customer;
  },
});

export const getCustomerByPhone = query({
  args: {
    businessId: v.id("businesses"),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("customers")
      .withIndex("by_business_phone", (q) =>
        q.eq("businessId", args.businessId).eq("phone", args.phone)
      )
      .unique();
  },
});

export const cleanupStaleCustomers = mutation({
  args: {
    businessId: v.id("businesses"),
    olderThanHours: v.optional(v.number()),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const olderThanHours = Math.max(1, args.olderThanHours || 24 * 30);
    const cutoffMs = Date.now() - olderThanHours * 60 * 60 * 1000;
    const limit = Math.min(Math.max(1, args.limit || 500), 5000);
    const dryRun = args.dryRun ?? true;

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
      .order("asc")
      .take(limit);

    let staleCount = 0;
    let deletedCount = 0;
    const staleCustomerIds: string[] = [];

    for (const customer of customers) {
      if (customer.lastInteraction >= cutoffMs) continue;
      const hasInteraction = await ctx.db
        .query("interactions")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
        .first();
      if (hasInteraction) continue;

      staleCount += 1;
      staleCustomerIds.push(customer._id);
      if (!dryRun) {
        await ctx.db.delete(customer._id);
        deletedCount += 1;
      }
    }

    return {
      dryRun,
      cutoffMs,
      scanned: customers.length,
      staleCount,
      deletedCount,
      staleCustomerIds,
    };
  },
});
