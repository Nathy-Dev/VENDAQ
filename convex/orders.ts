import { v } from "convex/values";
import { query } from "./_generated/server";

export const getOrdersByBusiness = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();

    // Group by status
    return {
      pending: orders.filter(o => o.status === "pending"),
      awaiting_payment: orders.filter(o => o.status === "awaiting_payment"),
      processing: orders.filter(o => o.status === "processing" || o.status === "shipped"),
      delivered: orders.filter(o => o.status === "delivered"),
    };
  },
});
