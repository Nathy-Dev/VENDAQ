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
      // Get the latest interaction for each customer
      const interactions = await ctx.db
        .query("interactions")
        .filter(q => q.eq(q.field("businessId"), args.businessId))
        .order("desc")
        .collect();

      const latestByCustomer = new Map();
      for (const interaction of interactions) {
        if (!latestByCustomer.has(interaction.customerId)) {
          latestByCustomer.set(interaction.customerId, interaction);
        }
      }

      // Fetch customer details for these interactions
      const results = [];
      for (const [customerId, lastInteraction] of latestByCustomer.entries()) {
        const customer = await ctx.db.get(customerId);
        if (customer) {
          results.push({
            ...customer,
            lastMessage: lastInteraction.content,
            lastMessageTimestamp: lastInteraction.timestamp,
            lastMessageType: lastInteraction.messageType,
            lastMediaId: lastInteraction.mediaId,
          });
        }
      }

      return results.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
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
