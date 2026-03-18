import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

// Called by the external Node.js Worker to emit the generated QR code
export const updateQRCode = mutation({
  args: {
    businessId: v.id("businesses"),
    qrCodeString: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.businessId, {
      qrCode: args.qrCodeString,
      whatsappStatus: "pending", // Emitting QR means connection is pending scan
    });
  },
});

// Called by the external Node.js Worker when socket connects/disconnects
export const updateConnectionStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    status: v.union(v.literal("connected"), v.literal("disconnected"), v.literal("error")),
  },
  handler: async (ctx, args) => {
    // If we are fully connected, clear the QR code so the UI can proceed
    const patchData: any = { whatsappStatus: args.status };
    if (args.status === "connected") {
        patchData.qrCode = undefined;
    }
    
    await ctx.db.patch(args.businessId, patchData);
  },
});

// Called by the Onboarding Frontend to stream the QR code
export const getBusinessQR = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    return {
        qrCode: business?.qrCode,
        status: business?.whatsappStatus,
    };
  },
});
// Called by the worker to sync a new incoming message
export const receiveMessage = mutation({
  args: {
    businessId: v.id("businesses"),
    sender: v.string(), // Phone number
    content: v.string(),
    timestamp: v.number(),
    fromMe: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // 1. Find or create the customer
    let customer = await ctx.db
      .query("customers")
      .withIndex("by_business_phone", (q) => 
        q.eq("businessId", args.businessId).eq("phone", args.sender)
      )
      .unique();

    if (!customer) {
      const customerId = await ctx.db.insert("customers", {
        businessId: args.businessId,
        phone: args.sender,
        name: args.sender, 
        totalValue: 0,
        lastInteraction: args.timestamp,
        tags: ["new-lead"],
      });
      customer = await ctx.db.get(customerId);
    } else {
        await ctx.db.patch(customer._id, {
            lastInteraction: args.timestamp,
        });
    }

    if (!customer) return;

    // 2. Insert the interaction
    await ctx.db.insert("interactions", {
      businessId: args.businessId,
      customerId: customer._id,
      role: args.fromMe ? "owner" : "customer",
      content: args.content,
      timestamp: args.timestamp,
    });
    
    return { success: true };
  },
});

