import { v } from "convex/values";
import { query } from "./_generated/server";

export const getInteractions = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("interactions")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(50);

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
          });
        }
      }

      return results.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
    },
});
