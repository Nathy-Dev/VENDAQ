import { v } from "convex/values";
import { query } from "./_generated/server";

export const getOrdersByBusiness = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();

    // Join customer data onto each order
    const enrichedOrders = await Promise.all(
      orders.map(async (order) => {
        const customer = await ctx.db.get(order.customerId);
        return {
          ...order,
          customerName: customer?.name,
          customerPhone: customer?.phone ?? "Unknown",
        };
      })
    );

    // Group by status
    return {
      pending: enrichedOrders.filter(o => o.status === "pending"),
      awaiting_payment: enrichedOrders.filter(o => o.status === "awaiting_payment"),
      processing: enrichedOrders.filter(o => o.status === "processing" || o.status === "shipped"),
      delivered: enrichedOrders.filter(o => o.status === "delivered"),
    };
  },
});
