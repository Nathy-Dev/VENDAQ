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
    sender: v.string(), // Phone number or Group JID
    content: v.string(),
    timestamp: v.number(),
    fromMe: v.optional(v.boolean()),
    isGroup: v.optional(v.boolean()),
    groupMetadata: v.optional(v.object({
      owner: v.optional(v.string()),
      participants: v.array(v.string()),
    })),
    messageType: v.optional(v.union(v.literal("text"), v.literal("image"), v.literal("video"), v.literal("audio"), v.literal("document"), v.literal("location"))),
    mediaId: v.optional(v.string()),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Find or create the customer (or group)
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
        isGroup: args.isGroup,
        groupMetadata: args.groupMetadata,
        totalValue: 0,
        lastInteraction: args.timestamp,
        tags: [args.isGroup ? "group" : "new-lead"],
      });
      customer = await ctx.db.get(customerId);
    } else {
        const patchData: any = { lastInteraction: args.timestamp };
        if (args.groupMetadata) patchData.groupMetadata = args.groupMetadata;
        await ctx.db.patch(customer._id, patchData);
    }

    if (!customer) return;

    // 2. Insert the interaction
    await ctx.db.insert("interactions", {
      businessId: args.businessId,
      customerId: customer._id,
      role: args.fromMe ? "owner" : "customer",
      content: args.content,
      timestamp: args.timestamp,
      messageType: args.messageType || "text",
      mediaId: args.mediaId,
      fileName: args.fileName,
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
      name: v.optional(v.string()),
      isGroup: v.optional(v.boolean()),
      messageType: v.optional(v.union(v.literal("text"), v.literal("image"), v.literal("video"), v.literal("audio"), v.literal("document"), v.literal("location"))),
      mediaId: v.optional(v.string()),
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
          isGroup: item.isGroup,
          totalValue: 0,
          lastInteraction: item.timestamp,
          tags: ["imported", item.isGroup ? "group" : "lead"],
        });
        customer = await ctx.db.get(customerId);
      } else {
          // Update last interaction if this one is newer
          if (item.timestamp > customer.lastInteraction) {
            await ctx.db.patch(customer._id, {
                lastInteraction: item.timestamp,
                name: item.name || customer.name, 
            });
          }
      }

      if (!customer) continue;

      // 2. Insert the interaction
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
          messageType: item.messageType || "text",
          mediaId: item.mediaId,
        });
      }
    }
    
    return { success: true, count: args.history.length };
  },
});

// Added for Full WhatsApp System
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const syncStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    sender: v.string(),
    content: v.optional(v.string()),
    mediaId: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // 24 hour expiry for statuses
    const expiresAt = args.timestamp + (24 * 60 * 60 * 1000);
    
    await ctx.db.insert("statuses", {
      businessId: args.businessId,
      sender: args.sender,
      content: args.content,
      mediaId: args.mediaId,
      mediaType: args.mediaType,
      timestamp: args.timestamp,
      expiresAt: expiresAt,
    });
  },
});

export const getStatuses = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db
      .query("statuses")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .filter((q) => q.gt(q.field("expiresAt"), now))
      .collect();
  },
});

