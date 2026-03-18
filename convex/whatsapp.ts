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

export const syncHistory = mutation({
  args: {
    businessId: v.id("businesses"),
    history: v.array(v.object({
      sender: v.string(),
      content: v.string(),
      timestamp: v.number(),
      fromMe: v.optional(v.boolean()),
      name: v.optional(v.string()), // Optional contact name
    })),
  },
  handler: async (ctx, args) => {
    console.log(`[Convex] Syncing history for business ${args.businessId}, ${args.history.length} items`);
    
    for (const item of args.history) {
      // 1. Find or create the customer
      let customer = await ctx.db
        .query("customers")
        .withIndex("by_business_phone", (q) => 
          q.eq("businessId", args.businessId).eq("phone", item.sender)
        )
        .unique();

      if (!customer) {
        const customerId = await ctx.db.insert("customers", {
          businessId: args.businessId,
          phone: item.sender,
          name: item.name || item.sender, 
          totalValue: 0,
          lastInteraction: item.timestamp,
          tags: ["imported"],
        });
        customer = await ctx.db.get(customerId);
      } else {
          // Update last interaction if this one is newer
          if (item.timestamp > customer.lastInteraction) {
            await ctx.db.patch(customer._id, {
                lastInteraction: item.timestamp,
                name: item.name || customer.name, // Update name if we just got a better one
            });
          }
      }

      if (!customer) continue;

      // 2. Insert the interaction (idempotency check by timestamp and content for now)
      // In a real app, we'd use a unique message ID from Baileys
      const existing = await ctx.db
        .query("interactions")
        .withIndex("by_customer", q => q.eq("customerId", customer!._id))
        .filter(q => q.and(
            q.eq(q.field("timestamp"), item.timestamp),
            q.eq(q.field("content"), item.content)
        ))
        .first();

      if (!existing) {
        await ctx.db.insert("interactions", {
          businessId: args.businessId,
          customerId: customer._id,
          role: item.fromMe ? "owner" : "customer",
          content: item.content,
          timestamp: item.timestamp,
        });
      }
    }
    
    return { success: true, count: args.history.length };
  },
});

