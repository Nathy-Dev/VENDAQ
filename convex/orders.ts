import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

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

export const createOrder = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    totalAmount: v.number(),
    items: v.array(v.object({
        name: v.string(),
        quantity: v.number(),
        price: v.number(),
    })),
    status: v.optional(v.union(
        v.literal("pending"),
        v.literal("awaiting_payment"),
        v.literal("paid"),
        v.literal("payment_failed"),
        v.literal("expired"),
        v.literal("processing"),
        v.literal("shipped"),
        v.literal("delivered"),
        v.literal("cancelled")
    )),
  },
  handler: async (ctx, args) => {
    const orderId = await ctx.db.insert("orders", {
      businessId: args.businessId,
      customerId: args.customerId,
      items: args.items,
      totalAmount: args.totalAmount,
      status: args.status || "pending",
      createdAt: Date.now(),
    });

    // Update customer total value
    const customer = await ctx.db.get(args.customerId);
    if (customer) {
        await ctx.db.patch(customer._id, {
            totalValue: (customer.totalValue || 0) + args.totalAmount,
            funnelStage: args.status === "paid" ? "paid" : args.status === "awaiting_payment" ? "awaiting_payment" : "order_created",
            tags: customer.tags.includes("customer") ? customer.tags : [...customer.tags, "customer"]
        });
    }

    return orderId;
  },
});

export const getOrderById = query({
  args: {
    businessId: v.id("businesses"),
    orderId: v.id("orders"),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order || order.businessId !== args.businessId) return null;
    const customer = await ctx.db.get(order.customerId);
    return {
      ...order,
      customerName: customer?.name,
      customerPhone: customer?.phone ?? "",
    };
  },
});

export const updateOrderStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    orderId: v.id("orders"),
    status: v.union(
      v.literal("pending"),
      v.literal("awaiting_payment"),
      v.literal("paid"),
      v.literal("payment_failed"),
      v.literal("expired"),
      v.literal("processing"),
      v.literal("shipped"),
      v.literal("delivered"),
      v.literal("cancelled")
    ),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order || order.businessId !== args.businessId) {
      throw new Error("Order not found.");
    }
    await ctx.db.patch(args.orderId, { status: args.status });
    const customer = await ctx.db.get(order.customerId);
    if (!customer) return;
    await ctx.db.patch(customer._id, {
      funnelStage: args.status === "paid" || args.status === "delivered"
        ? "paid"
        : args.status === "awaiting_payment"
          ? "awaiting_payment"
          : args.status === "payment_failed" || args.status === "expired"
            ? "lost"
            : "order_created",
    });
  },
});
