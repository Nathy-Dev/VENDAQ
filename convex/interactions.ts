import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

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
      // 1. Get the 100 most recently active customers using our new index
      // This avoids scanning thousands of interactions, making the query instant.
      const customers = await ctx.db
        .query("customers")
        .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
        .order("desc")
        .take(100);

      const results = [];
      for (const customer of customers) {
        // 2. Fetch only the ONE most recent message for this specific customer
        const lastInteraction = await ctx.db
          .query("interactions")
          .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
          .order("desc")
          .first();

        // Include the customer even if no interaction is explicitly found in DB (e.g. sync gap)
        // Fallback to customer.lastInteraction and a placeholder
        results.push({
          ...customer,
          lastMessage: lastInteraction?.content || "Existing conversation",
          lastMessageTimestamp: lastInteraction?.timestamp || customer.lastInteraction,
          lastMessageType: lastInteraction?.messageType,
          lastMediaId: lastInteraction?.mediaId,
          lastIntent: lastInteraction?.intent || customer.lastIntent,
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
