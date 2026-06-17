import { v } from "convex/values";
import { mutation, query, action } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import * as evoClient from "./evolutionGoClient";

const VIEWER_FOLLOW_UP_DELAY_MS = 2 * 60 * 60 * 1000;
const BUYING_SIGNAL_FOLLOW_UP_DELAY_MS = 2 * 60 * 60 * 1000;
const AWAITING_PAYMENT_REMINDER_DELAY_MS = 3 * 60 * 60 * 1000;
const SECOND_REMINDER_DELAY_MS = 9 * 60 * 60 * 1000;
const DEFAULT_ESTIMATED_ORDER_VALUE = 15000;
const DEFAULT_RESPONSE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

type MessageClassification = "BUYING_SIGNAL" | "GENERAL_INQUIRY" | "NOISE";

const BUYING_SIGNAL_KEYWORDS = [
  "how much", "price", "cost", "rate", "available", "in stock",
  "do you have", "i want", "i need", "send me", "order", "buy",
  "discount", "best price"
];

function classifyMessage(content: string, messageType?: string): { classification: MessageClassification; matchedKeywords: string[] } {
  const text = content.trim().toLowerCase();
  if (!text && messageType && messageType !== "text") {
    return { classification: "GENERAL_INQUIRY", matchedKeywords: [] };
  }

  const matched = BUYING_SIGNAL_KEYWORDS.filter(kw => text.includes(kw));
  if (matched.length > 0) return { classification: "BUYING_SIGNAL", matchedKeywords: matched };
  if (text.includes("?") || /^(what|where|when|how|who|why|can|do|is|are|will|could)\b/.test(text)) {
    return { classification: "GENERAL_INQUIRY", matchedKeywords: [] };
  }
  return { classification: "NOISE", matchedKeywords: [] };
}

function inferMemoryPatch(content: string): Record<string, unknown> {
  const text = content.toLowerCase();
  const patch: Record<string, unknown> = {
    memorySummaryUpdatedAt: Date.now(),
  };

  if (/(price|how much|cost|discount)/.test(text)) patch.memoryLastAskedTopic = "pricing";
  if (/(size|fit|color|variant|available)/.test(text)) patch.memoryLastAskedTopic = "availability";
  if (/(expensive|too much|can't afford|later)/.test(text)) patch.memoryLastObjection = "price";
  if (/(delivery|ship|waybill)/.test(text)) patch.memoryLastAskedTopic = "delivery";
  if (/(shoe|sneaker|slipper)/.test(text)) patch.memoryPreferredCategory = "footwear";
  if (/(bag|purse)/.test(text)) patch.memoryPreferredCategory = "bags";
  return patch;
}

function isRawName(name: string | undefined, phone: string): boolean {
    if (!name || name === "Group Chat") return true;
    if (name.includes('@')) return true;
    if (name === phone || name === phone.split('@')[0]) return true;
    
    // Check if it's strictly digits, spaces, dashes, or plus signs (a raw phone number)
    const cleaned = name.replace(/[\s\-\(\)\+]/g, '');
    if (/^\d+$/.test(cleaned)) return true;
    
    return false;
}

function normalizePhoneDigits(phone: string | undefined): string {
  return (phone || "").replace(/\D/g, "");
}

function normalizePhoneForWhatsApp(phone: string): string {
  return normalizePhoneDigits(phone);
}

function slugifyInstanceName(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "pipelixr";
}

function getEvolutionInstanceName(label: string, stableId: string): string {
  const suffix = stableId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  const base = slugifyInstanceName(label).slice(0, Math.max(12, 24 - suffix.length));
  return `${base}-${suffix || "instance"}`;
}

// Called by the external Node.js Worker to emit the generated QR code
export const updateQRCode = mutation({
  args: {
    businessId: v.id("businesses"),
    qrCodeString: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.businessId, {
      qrCode: args.qrCodeString,
      pairingCode: undefined,
      whatsappStatus: "pending", // Emitting QR means connection is pending scan
    });
  },
});

// Called by the external Node.js Worker when socket connects/disconnects
export const updateConnectionStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    status: v.union(v.literal("connected"), v.literal("disconnected"), v.literal("error"), v.literal("pending")),
  },
  handler: async (ctx, args) => {
    // If we are fully connected, clear the QR code so the UI can proceed
    const patchData: {
      whatsappStatus: "connected" | "disconnected" | "error" | "pending";
      qrCode?: string;
      pairingCode?: string;
    } = {
      whatsappStatus: args.status,
    };
    if (args.status === "connected") {
        patchData.qrCode = undefined;
        patchData.pairingCode = undefined;
    }
    
    await ctx.db.patch(args.businessId, patchData);
  },
});

export const updatePairingCode = mutation({
  args: {
    businessId: v.id("businesses"),
    pairingCode: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.businessId, {
      pairingCode: args.pairingCode,
      qrCode: undefined,
      whatsappStatus: "pending", 
    });
  },
});

export const clearPairingCode = mutation({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.businessId, {
      pairingCode: undefined,
    });
  },
});

// Called by the Onboarding Frontend to stream the QR code
export const getBusinessQR = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    return {
        qrCode: business?.qrCode,
        pairingCode: business?.pairingCode,
        status: business?.whatsappStatus,
    };
  },
});

// Called by the worker on boot to auto-connect active sessions
export const getConnectedBusinesses = query({
  args: {},
  handler: async (ctx) => {
    const businesses = await ctx.db.query("businesses")
      .filter((q) => q.eq(q.field("whatsappStatus"), "connected"))
      .collect();
    return businesses.map(b => ({ _id: b._id }));
  },
});

export const updateContactName = mutation({
  args: {
    businessId: v.id("businesses"),
    phone: v.string(),
    name: v.string(),
    isGroup: v.optional(v.boolean()),
    createIfMissing: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_business_phone", (q) => 
        q.eq("businessId", args.businessId).eq("phone", args.phone)
      )
      .unique();

    if (customer) {
        // Only update if the new name is better than the current one
        const currentIsRaw = isRawName(customer.name, customer.phone);
        const newIsRaw = isRawName(args.name, args.phone);
        
        if (currentIsRaw && !newIsRaw && args.name) {
            await ctx.db.patch(customer._id, { name: args.name });
        }
    } else {
        if (args.createIfMissing === false) {
            return;
        }
        await ctx.db.insert("customers", {
            businessId: args.businessId,
            phone: args.phone,
            name: args.name,
            isGroup: args.isGroup,
            totalValue: 0,
            lastInteraction: Date.now(),
            leadSource: "dm",
            funnelStage: "engaged",
            lastInboundAt: Date.now(),
            tags: [args.isGroup ? "group" : "contact"],
        });
    }
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
    name: v.optional(v.string()),
    whatsappMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Deduplication: Check if this message already exists
    if (args.whatsappMessageId) {
      const existing = await ctx.db
        .query("interactions")
        .withIndex("by_whatsapp_id", (q) => q.eq("whatsappMessageId", args.whatsappMessageId))
        .first();
      if (existing) {
        console.log(`[receiveMessage] Deduplicated message: ${args.whatsappMessageId}`);
        return { success: true, messageId: existing._id };
      }
    } else {
      // Fallback deduplication: same customer, content, and very close timestamp (within 2s)
      const customer = await ctx.db
        .query("customers")
        .withIndex("by_business_phone", (q) => 
          q.eq("businessId", args.businessId).eq("phone", args.sender)
        )
        .unique();
      
      if (customer) {
        const dupe = await ctx.db
          .query("interactions")
          .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
          .filter((q) => q.and(
            q.eq(q.field("content"), args.content),
            q.gt(q.field("timestamp"), args.timestamp - 2000),
            q.lt(q.field("timestamp"), args.timestamp + 2000)
          ))
          .first();
        if (dupe) {
          return { success: true, messageId: dupe._id };
        }
      }
    }

    // 2. Find or create the customer (or group)
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
        name: args.name || args.sender, 
        isGroup: args.isGroup,
        groupMetadata: args.groupMetadata,
        totalValue: 0,
        lastInteraction: args.timestamp,
        leadSource: "dm",
        funnelStage: "engaged",
        lastInboundAt: args.timestamp,
        tags: [args.isGroup ? "group" : "new-lead"],
      });
      customer = await ctx.db.get(customerId);
    } else {
        const patchData: {
          lastInteraction: number;
          lastInboundAt?: number;
          lastOutboundAt?: number;
          groupMetadata?: { owner?: string; participants: string[] };
          name?: string;
        } = {
          lastInteraction: args.timestamp,
          lastInboundAt: args.fromMe ? customer.lastInboundAt : args.timestamp,
          lastOutboundAt: args.fromMe ? args.timestamp : customer.lastOutboundAt,
        };
        if (args.groupMetadata) patchData.groupMetadata = args.groupMetadata;
        
        // Update name if we have a new one and the current one is primitive
        const currentIsRaw = isRawName(customer.name, customer.phone);
        const newIsRaw = isRawName(args.name, args.sender);
        
        if (currentIsRaw && !newIsRaw && args.name) {
            patchData.name = args.name;
        }
        
        await ctx.db.patch(customer._id, patchData);
    }

    if (!customer) return;

    const { classification } = classifyMessage(args.content, args.messageType || "text");
    const memoryPatch = inferMemoryPatch(args.content);
    if (!args.fromMe) {
      await ctx.db.patch(customer._id, {
        ...memoryPatch,
        lastIntent: classification,
        funnelStage: classification === "BUYING_SIGNAL" ? "intent" : "engaged",
      });
    } else {
      await ctx.db.patch(customer._id, memoryPatch);
    }

    // 2. Insert the interaction
    const interactionId = await ctx.db.insert("interactions", {
      businessId: args.businessId,
      customerId: customer._id,
      role: args.fromMe ? "owner" : "customer",
      content: args.content,
      timestamp: args.timestamp,
      messageType: args.messageType || "text",
      mediaId: args.mediaId,
      fileName: args.fileName,
      whatsappMessageId: args.whatsappMessageId,
      intent: classification,
    });

    if (args.fromMe) {
      const pendingSignalTasks = await ctx.db
        .query("followUpTasks")
        .withIndex("by_customer_reason", (q) => q.eq("customerId", customer._id).eq("reason", "buying_signal"))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .collect();

      for (const task of pendingSignalTasks) {
        if (task.scheduledFunctionId) {
          try {
            await ctx.scheduler.cancel(task.scheduledFunctionId as any);
          } catch (error) {
            console.warn(`[receiveMessage] Could not cancel scheduled follow-up ${task.scheduledFunctionId}`, error);
          }
        }
        await ctx.db.patch(task._id, { status: "cancelled" });
      }
    }

    if (!args.fromMe && classification === "BUYING_SIGNAL") {
      const biz = await ctx.db.get(args.businessId);
      const windowMs = biz?.responseWindowMinutes
        ? biz.responseWindowMinutes * 60 * 1000
        : DEFAULT_RESPONSE_WINDOW_MS;
      const taskId = await ctx.db.insert("followUpTasks", {
        businessId: args.businessId,
        customerId: customer._id,
        reason: "buying_signal",
        dueAt: args.timestamp + windowMs,
        status: "pending",
        createdAt: args.timestamp,
      });
      const scheduledFunctionId = await ctx.scheduler.runAfter(
        windowMs,
        api.whatsapp.processBuyingSignalFollowUp,
        {
          businessId: args.businessId,
          customerId: customer._id,
          taskId,
          interactionId,
        }
      );
      await ctx.db.patch(taskId, { scheduledFunctionId });
    }

    if (!args.fromMe) {
      const recentSentOutcome = await ctx.db
        .query("actionOutcomes")
        .withIndex("by_customer_status", (q) => q.eq("customerId", customer._id).eq("status", "sent"))
        .order("desc")
        .first();

      if (recentSentOutcome) {
        await ctx.db.patch(recentSentOutcome._id, {
          status: "replied",
          repliedAt: args.timestamp,
        });
      }
    }
    
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
      whatsappMessageId: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const historyWindowHours = Number(process.env.HISTORY_SYNC_WINDOW_HOURS || 24);
    const cutoffMs = Date.now() - historyWindowHours * 60 * 60 * 1000;
    const recentHistory = args.history.filter((item) => item.timestamp >= cutoffMs);
    console.log(
      `[Convex] Syncing history for business ${args.businessId}, received=${args.history.length}, recent=${recentHistory.length}, window=${historyWindowHours}h`
    );
    
    for (const item of recentHistory) {
      // Determine if the incoming name is actually useful (not a LID/raw number)
      const incomingNameIsReal = item.name && !isRawName(item.name, item.sender);
      const displayName = incomingNameIsReal ? item.name : undefined;

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
          name: displayName || item.sender, 
          isGroup: item.isGroup,
          totalValue: 0,
          lastInteraction: item.timestamp,
          leadSource: "imported",
          funnelStage: "engaged",
          lastInboundAt: item.fromMe ? undefined : item.timestamp,
          lastOutboundAt: item.fromMe ? item.timestamp : undefined,
          tags: ["imported", item.isGroup ? "group" : "lead"],
        });
        customer = await ctx.db.get(customerId);
      } else {
          const patchData: Record<string, unknown> = {};
          
          // Update last interaction if this one is newer
          if (item.timestamp > customer.lastInteraction) {
            patchData.lastInteraction = item.timestamp;
          }
          if (item.fromMe) {
            patchData.lastOutboundAt = item.timestamp;
          } else {
            patchData.lastInboundAt = item.timestamp;
          }
          
          // Update name if old one looks raw and new one is real
          if (displayName && isRawName(customer.name, customer.phone)) {
            patchData.name = displayName;
          }
          
          if (Object.keys(patchData).length > 0) {
            await ctx.db.patch(customer._id, patchData);
          }
      }

      if (!customer) continue;

      if (item.whatsappMessageId) {
        const existingByWhatsappId = await ctx.db
          .query("interactions")
          .withIndex("by_whatsapp_id", (q) => q.eq("whatsappMessageId", item.whatsappMessageId!))
          .first();
        if (existingByWhatsappId) {
          continue;
        }
      }

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
          whatsappMessageId: item.whatsappMessageId,
        });
      }
    }

    await ctx.db.patch(args.businessId, {
      lastHistorySyncAt: Date.now(),
      lastHistorySyncCount: recentHistory.length,
      lastHistorySyncWindowHours: historyWindowHours,
    });
    
    return { success: true, count: recentHistory.length };
  },
}); 

export const updateMessage = mutation({
  args: {
    businessId: v.id("businesses"),
    whatsappMessageId: v.string(),
    content: v.optional(v.string()),
    isDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("interactions")
      .withIndex("by_whatsapp_id", (q) => q.eq("whatsappMessageId", args.whatsappMessageId))
      .first();

    if (!existing) {
      console.warn(`[updateMessage] Message not found: ${args.whatsappMessageId}`);
      return;
    }

    if (args.isDeleted) {
      await ctx.db.patch(existing._id, { content: "🚫 This message was deleted", isEdited: true });
    } else if (args.content) {
      await ctx.db.patch(existing._id, { content: args.content, isEdited: true });
    }
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
    whatsappMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Deduplication for status
    if (args.whatsappMessageId) {
        const existing = await ctx.db
            .query("statuses")
            .withIndex("by_whatsapp_id", (q) => q.eq("whatsappMessageId", args.whatsappMessageId))
            .first();
        if (existing) return;
    }

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
      whatsappMessageId: args.whatsappMessageId,
    });
  },
});

export const syncStatusView = mutation({
  args: {
    businessId: v.id("businesses"),
    whatsappStatusId: v.string(),
    viewerPhone: v.string(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // 1. Find the status if it exists
    const status = await ctx.db
        .query("statuses")
        .withIndex("by_whatsapp_id", (q) => q.eq("whatsappMessageId", args.whatsappStatusId))
        .first();

    // 2. Deduplicate view
    const existing = await ctx.db
        .query("statusViews")
        .withIndex("by_status", (q) => q.eq("whatsappStatusId", args.whatsappStatusId))
        .filter((q) => q.eq(q.field("viewerPhone"), args.viewerPhone))
        .first();
    
    if (existing) return;

    // 3. Insert view
    await ctx.db.insert("statusViews", {
        businessId: args.businessId,
        statusId: status?._id,
        whatsappStatusId: args.whatsappStatusId,
        viewerPhone: args.viewerPhone,
        timestamp: args.timestamp,
    });
    
    // 4. Update or create customer as a lead
    let customer = await ctx.db
        .query("customers")
        .withIndex("by_business_phone", (q) => 
            q.eq("businessId", args.businessId).eq("phone", args.viewerPhone)
        )
        .unique();
    
    if (!customer) {
        const customerId = await ctx.db.insert("customers", {
            businessId: args.businessId,
            phone: args.viewerPhone,
            name: args.viewerPhone, // We don't have a name yet
            totalValue: 0,
            lastInteraction: args.timestamp,
            leadSource: "status_view",
            funnelStage: "viewer",
            lastStatusViewedAt: args.timestamp,
            tags: ["status-viewer", "new-lead"],
        });
        customer = await ctx.db.get(customerId);
    } else {
        // Tag existing customer as status viewer if not already
        await ctx.db.patch(customer._id, {
          tags: customer.tags.includes("status-viewer") ? customer.tags : [...customer.tags, "status-viewer"],
          leadSource: customer.leadSource || "status_view",
          funnelStage: customer.funnelStage === "paid" ? "paid" : "viewer",
          lastStatusViewedAt: args.timestamp,
        });
    }

    if (!customer) return;

    const recentInbound = await ctx.db
      .query("interactions")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .filter((q) => q.and(
        q.eq(q.field("role"), "customer"),
        q.gt(q.field("timestamp"), args.timestamp)
      ))
      .first();

    if (!recentInbound) {
      const existingTask = await ctx.db
        .query("followUpTasks")
        .withIndex("by_customer_reason", (q) => q.eq("customerId", customer!._id).eq("reason", "viewed_no_dm"))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .first();

      if (!existingTask) {
        await ctx.db.insert("followUpTasks", {
          businessId: args.businessId,
          customerId: customer._id,
          reason: "viewed_no_dm",
          dueAt: args.timestamp + VIEWER_FOLLOW_UP_DELAY_MS,
          status: "pending",
          createdAt: Date.now(),
        });
      }
    }
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

export const getStatusViews = query({
  args: { businessId: v.id("businesses"), whatsappStatusId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
        .query("statusViews")
        .withIndex("by_status", (q) => q.eq("whatsappStatusId", args.whatsappStatusId))
        .filter((q) => q.eq(q.field("businessId"), args.businessId))
        .collect();
  },
});

export const getMessageTemplates = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messageTemplates")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

export const seedDefaultTemplates = mutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("messageTemplates")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    if (existing.length > 0) return existing;

    const now = Date.now();
    const defaults = [
      { name: "Quick Reopen", type: "reopen_conversation" as const, body: "Hi! Thanks for viewing our status. Do you want the current price list?" },
      { name: "Checkout Prompt", type: "checkout" as const, body: "Ready to order? Send the item name and quantity, and I will prepare checkout." },
    ];
    for (const template of defaults) {
      await ctx.db.insert("messageTemplates", {
        businessId: args.businessId,
        name: template.name,
        type: template.type,
        body: template.body,
        isActive: true,
        createdAt: now,
      });
    }

    return await ctx.db
      .query("messageTemplates")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});

export const getStatusToCashMetrics = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const views = await ctx.db
      .query("statusViews")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();

    const uniquePhones = new Set(views.map((view) => view.viewerPhone));
    const customers = await Promise.all(
      [...uniquePhones].map((phone) =>
        ctx.db.query("customers").withIndex("by_business_phone", (q) => q.eq("businessId", args.businessId).eq("phone", phone)).unique()
      )
    );

    const engaged = customers.filter((c) => !!c && (c.lastInboundAt || c.lastIntent)).length;
    const orders = await ctx.db.query("orders").withIndex("by_business", (q) => q.eq("businessId", args.businessId)).collect();
    const paidOrders = orders.filter((o) => o.status === "paid" || o.status === "delivered");

    return {
      statusViews: views.length,
      conversationsStarted: engaged,
      ordersCreated: orders.length,
      paymentsCompleted: paidOrders.length,
    };
  },
});

export const getViewersWithoutEngagement = query({
  args: {
    businessId: v.id("businesses"),
    hours: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.hours * 60 * 60 * 1000;
    const views = await ctx.db
      .query("statusViews")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .filter((q) => q.gt(q.field("timestamp"), cutoff))
      .collect();

    const uniqueViewerPhones = [...new Set(views.map((view) => view.viewerPhone))];
    const results: Array<{ phone: string; customerId: string; viewedAt: number }> = [];

    for (const viewerPhone of uniqueViewerPhones) {
      const customer = await ctx.db
        .query("customers")
        .withIndex("by_business_phone", (q) => q.eq("businessId", args.businessId).eq("phone", viewerPhone))
        .unique();

      if (!customer) continue;
      const hasInbound = !!customer.lastInboundAt && customer.lastInboundAt > cutoff;
      if (hasInbound) continue;
      results.push({ phone: viewerPhone, customerId: customer._id, viewedAt: customer.lastStatusViewedAt || customer.lastInteraction });
    }

    return results;
  },
});

export const bulkRetargetViewers = mutation({
  args: {
    businessId: v.id("businesses"),
    templateId: v.id("messageTemplates"),
    viewerPhones: v.optional(v.array(v.string())),
    hours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template || template.businessId !== args.businessId || !template.isActive) {
      throw new Error("Template not found or inactive.");
    }

    const minTimestamp = Date.now() - ((args.hours || 24) * 60 * 60 * 1000);
    const phones = args.viewerPhones || [...new Set((await ctx.db.query("statusViews").withIndex("by_business", (q) => q.eq("businessId", args.businessId)).filter((q) => q.gt(q.field("timestamp"), minTimestamp)).collect()).map((v) => v.viewerPhone))];

    let sent = 0;
    for (const phone of phones) {
      const customer = await ctx.db
        .query("customers")
        .withIndex("by_business_phone", (q) => q.eq("businessId", args.businessId).eq("phone", phone))
        .unique();
      if (!customer) continue;

      await ctx.db.insert("interactions", {
        businessId: args.businessId,
        customerId: customer._id,
        role: "owner",
        content: template.body,
        timestamp: Date.now(),
        messageType: "text",
      });
      await ctx.db.patch(customer._id, {
        lastOutboundAt: Date.now(),
        funnelStage: customer.funnelStage === "viewer" ? "engaged" : customer.funnelStage,
      });
      sent += 1;
    }

    return {
      success: true,
      sent,
      template: template.name,
    };
  },
});

export const openChatFromViewer = mutation({
  args: {
    businessId: v.id("businesses"),
    viewerPhone: v.string(),
  },
  handler: async (ctx, args) => {
    let customer = await ctx.db
      .query("customers")
      .withIndex("by_business_phone", (q) => q.eq("businessId", args.businessId).eq("phone", args.viewerPhone))
      .unique();

    if (!customer) {
      const id = await ctx.db.insert("customers", {
        businessId: args.businessId,
        phone: args.viewerPhone,
        name: args.viewerPhone,
        totalValue: 0,
        lastInteraction: Date.now(),
        leadSource: "status_view",
        funnelStage: "engaged",
        tags: ["status-viewer", "lead"],
      });
      customer = await ctx.db.get(id);
    } else {
      await ctx.db.patch(customer._id, {
        funnelStage: customer.funnelStage === "viewer" ? "engaged" : customer.funnelStage,
      });
    }

    return {
      customerId: customer?._id,
      normalizedPhone: normalizePhoneForWhatsApp(args.viewerPhone),
      deepLink: `https://wa.me/${normalizePhoneForWhatsApp(args.viewerPhone)}`,
    };
  },
});

export const promoteChatToOrderDraft = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    fallbackAmount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId) {
      throw new Error("Customer not found.");
    }

    const recent = await ctx.db
      .query("interactions")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(8);

    const joined = recent.map((item) => item.content).join(" ").toLowerCase();
    const amountMatch = joined.match(/(?:₦|ngn|n)\s?(\d[\d,]*)|(\d[\d,]{3,})/i);
    const parsed = amountMatch ? parseInt((amountMatch[1] || amountMatch[2] || "0").replace(/,/g, ""), 10) : 0;
    const amount = parsed > 0 ? parsed : args.fallbackAmount || 0;

    const skuHints = ["shoe", "sneaker", "bag", "watch", "shirt", "dress"];
    const inferred = skuHints.find((term) => joined.includes(term)) || "Requested Item";

    const orderId = await ctx.db.insert("orders", {
      businessId: args.businessId,
      customerId: args.customerId,
      items: [{ name: inferred, quantity: 1, price: amount }],
      totalAmount: amount,
      status: "pending",
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.customerId, {
      funnelStage: "order_created",
      lastIntent: "BUYING_SIGNAL",
    });

    return { orderId, amount, item: inferred };
  },
});

export const sendCheckoutForOrder = action({
  args: {
    businessId: v.id("businesses"),
    orderId: v.id("orders"),
  },
  handler: async (ctx, args) => {
    const workerUrl = process.env.WHATSAPP_WORKER_URL || "http://localhost:3005";
    const order = await ctx.runQuery(api.orders.getOrderById, { businessId: args.businessId, orderId: args.orderId });
    if (!order) throw new Error("Order not found.");

    const checkoutMessage = `Checkout ready. Amount: NGN ${order.totalAmount.toLocaleString()}. Reply with payment confirmation after transfer.`;
    const sendRes = await fetch(`${workerUrl}/message/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: args.businessId,
        to: order.customerPhone,
        content: checkoutMessage,
      }),
    });

    if (!sendRes.ok) {
      throw new Error(`Worker send failed: ${await sendRes.text()}`);
    }

    await ctx.runMutation(api.orders.updateOrderStatus, {
      businessId: args.businessId,
      orderId: args.orderId,
      status: "awaiting_payment",
    });

    await ctx.runMutation(api.whatsapp.createAwaitingPaymentTask, {
      businessId: args.businessId,
      customerId: order.customerId,
      dueAt: Date.now() + AWAITING_PAYMENT_REMINDER_DELAY_MS,
      reason: "awaiting_payment",
    });

    return { success: true };
  },
});

export const createAwaitingPaymentTask = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    dueAt: v.number(),
    reason: v.union(v.literal("awaiting_payment"), v.literal("asked_no_order"), v.literal("viewed_no_dm")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("followUpTasks", {
      businessId: args.businessId,
      customerId: args.customerId,
      reason: args.reason,
      dueAt: args.dueAt,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const processPaymentFollowUps = action({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tasks = await ctx.runQuery(api.whatsapp.getDuePaymentTasks, {
      businessId: args.businessId,
      now,
    });
    let processed = 0;
    for (const task of tasks) {
      await ctx.runAction(api.whatsapp.sendRetargetMessage, {
        businessId: args.businessId,
        customerId: task.customerId,
        content: "Quick reminder: your payment is still pending. Reply if you need help completing checkout.",
      });
      await ctx.runMutation(api.whatsapp.markTaskDone, { taskId: task._id });
      await ctx.runMutation(api.whatsapp.createAwaitingPaymentTask, {
        businessId: args.businessId,
        customerId: task.customerId,
        dueAt: now + SECOND_REMINDER_DELAY_MS,
        reason: "awaiting_payment",
      });
      processed += 1;
    }
    return { processed };
  },
});

export const getDuePaymentTasks = query({
  args: { businessId: v.id("businesses"), now: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("followUpTasks")
      .withIndex("by_business_due", (q) => q.eq("businessId", args.businessId).lte("dueAt", args.now))
      .filter((q) => q.and(q.eq(q.field("status"), "pending"), q.eq(q.field("reason"), "awaiting_payment")))
      .collect();
  },
});

export const markTaskDone = mutation({
  args: { taskId: v.id("followUpTasks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, { status: "done" });
  },
});

export const markTaskSkipped = mutation({
  args: { taskId: v.id("followUpTasks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, { status: "skipped" });
  },
});

export const markTaskCancelled = mutation({
  args: { taskId: v.id("followUpTasks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, { status: "cancelled" });
  },
});

export const getFollowUpTaskById = query({
  args: { taskId: v.id("followUpTasks") },
  handler: async (ctx, args) => await ctx.db.get(args.taskId),
});

export const getOwnerRepliesForCustomerSince = query({
  args: {
    customerId: v.id("customers"),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    const replies = await ctx.db
      .query("interactions")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .filter((q) =>
        q.and(
          q.eq(q.field("role"), "owner"),
          q.gt(q.field("timestamp"), args.since)
        )
      )
      .take(1);
    return replies.length;
  },
});

function buildBuyingSignalFollowUp(customerName: string, template?: string): string {
  if (template) {
    return template.replace(/\[Customer Name\]/gi, customerName);
  }
  return `Hi ${customerName}, thanks for reaching out. We saw your message and will get back to you shortly. What exactly were you looking for today?`;
}

export const processBuyingSignalFollowUp = action({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    taskId: v.id("followUpTasks"),
    interactionId: v.id("interactions"),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; reason?: string }> => {
    const task = await ctx.runQuery(api.whatsapp.getFollowUpTaskById, { taskId: args.taskId });
    if (!task || task.status !== "pending" || task.reason !== "buying_signal") {
      return { sent: false, reason: "task_not_pending" };
    }

    const ownerReplies = await ctx.runQuery(api.whatsapp.getOwnerRepliesForCustomerSince, {
      customerId: args.customerId,
      since: task.createdAt,
    });
    if (ownerReplies > 0) {
      await ctx.runMutation(api.whatsapp.markTaskCancelled, { taskId: args.taskId });
      return { sent: false, reason: "owner_replied" };
    }

    const allowed = await ctx.runQuery(api.whatsapp.canSendToCustomerNow, {
      businessId: args.businessId,
      customerId: args.customerId,
    });
    if (!allowed) {
      await ctx.runMutation(api.whatsapp.markTaskSkipped, { taskId: args.taskId });
      return { sent: false, reason: "guardrail_blocked" };
    }

    const customer = await ctx.runQuery(api.whatsapp.getCustomerLiteById, { customerId: args.customerId });
    if (!customer) {
      await ctx.runMutation(api.whatsapp.markTaskSkipped, { taskId: args.taskId });
      return { sent: false, reason: "customer_not_found" };
    }

    const biz = await ctx.runQuery(api.whatsapp.getBusinessForAssistantAuth, { businessId: args.businessId });
    const customerName = customer.name || customer.phone.split("@")[0];
    const content = buildBuyingSignalFollowUp(customerName, biz?.followUpTemplate);
    const result = await ctx.runAction(api.whatsapp.sendRetargetMessage, {
      businessId: args.businessId,
      customerId: args.customerId,
      content,
    });

    if (!result?.sent) {
      await ctx.runMutation(api.whatsapp.markTaskSkipped, { taskId: args.taskId });
      return { sent: false, reason: "send_failed" };
    }

    await ctx.runMutation(api.whatsapp.markTaskDone, { taskId: args.taskId });
    await ctx.runMutation(api.whatsapp.logActionOutcomeSent, {
      businessId: args.businessId,
      customerId: args.customerId,
      suggestedMessage: content,
      initialIntent: "BUYING_SIGNAL",
      scoreAtSend: 100,
      estimatedValue: estimateCustomerValue(customer.totalValue, "BUYING_SIGNAL"),
    });

    return { sent: true };
  },
});

export const getRetargetSegments = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
      .collect();

    const viewedNotReplied = customers.filter((c) => c.lastStatusViewedAt && (!c.lastInboundAt || c.lastInboundAt < c.lastStatusViewedAt));
    const repliedNotOrdered = customers.filter((c) => c.lastInboundAt && c.funnelStage !== "order_created" && c.funnelStage !== "awaiting_payment" && c.funnelStage !== "paid");
    const orderedNotPaid = customers.filter((c) => c.funnelStage === "awaiting_payment" || c.funnelStage === "order_created");
    const paidCrossSell = customers.filter((c) => c.funnelStage === "paid");

    return {
      viewed_not_replied: viewedNotReplied.map((c) => ({ customerId: c._id, phone: c.phone })),
      replied_not_ordered: repliedNotOrdered.map((c) => ({ customerId: c._id, phone: c.phone })),
      ordered_not_paid: orderedNotPaid.map((c) => ({ customerId: c._id, phone: c.phone })),
      paid_cross_sell_candidate: paidCrossSell.map((c) => ({ customerId: c._id, phone: c.phone })),
    };
  },
});

export const createAutomationRun = mutation({
  args: {
    businessId: v.id("businesses"),
    segment: v.string(),
    templateId: v.id("messageTemplates"),
    mode: v.union(v.literal("manual"), v.literal("scheduled")),
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("automationRuns", {
      businessId: args.businessId,
      segment: args.segment,
      templateId: args.templateId,
      mode: args.mode,
      scheduledAt: args.scheduledAt,
      status: args.mode === "manual" ? "running" : "pending",
      sentCount: 0,
      createdAt: Date.now(),
    });
  },
});

export const executeAutomationRun = action({
  args: { businessId: v.id("businesses"), runId: v.id("automationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(api.whatsapp.getAutomationRunById, { runId: args.runId });
    if (!run) throw new Error("Run not found.");
    const template = await ctx.runQuery(api.whatsapp.getTemplateById, { templateId: run.templateId });
    if (!template) throw new Error("Template not found.");
    const segments = await ctx.runQuery(api.whatsapp.getRetargetSegments, { businessId: args.businessId });
    const targets = (
      segments as Record<string, Array<{ customerId: Id<"customers"> }>>
    )[run.segment] || [];

    let sent = 0;
    for (const target of targets) {
      const allowed = await ctx.runQuery(api.whatsapp.canSendToCustomerNow, { businessId: args.businessId, customerId: target.customerId });
      if (!allowed) continue;
      await ctx.runAction(api.whatsapp.sendRetargetMessage, {
        businessId: args.businessId,
        customerId: target.customerId,
        content: template.body,
      });
      sent += 1;
    }

    await ctx.runMutation(api.whatsapp.finishAutomationRun, { runId: args.runId, sentCount: sent });
    return { sent };
  },
});

export const processScheduledAutomationRuns = action({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const dueRuns = await ctx.runQuery(api.whatsapp.getDueAutomationRuns, { businessId: args.businessId, now: Date.now() });
    let processed = 0;
    for (const run of dueRuns) {
      await ctx.runMutation(api.whatsapp.markAutomationRunRunning, { runId: run._id });
      await ctx.runAction(api.whatsapp.executeAutomationRun, { businessId: args.businessId, runId: run._id });
      processed += 1;
    }
    return { processed };
  },
});

export const sendRetargetMessage = action({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; reason?: string }> => {
    const customer = await ctx.runQuery(api.whatsapp.getCustomerLiteById, { customerId: args.customerId });
    if (!customer) return { sent: false, reason: "customer_not_found" };

    const biz = await ctx.runQuery(api.whatsapp.getBusinessForAssistantAuth, { businessId: args.businessId });
    const instanceName = biz?.evolutionInstanceName || getEvolutionInstanceName(biz?.name || "pipelixr", args.businessId);

    try {
      await evoClient.sendText(instanceName, customer.phone, args.content);
    } catch (e) {
      console.error("[sendRetargetMessage] Evolution Go send failed:", e);
      return { sent: false, reason: "evolution_send_failed" };
    }

    await ctx.runMutation(api.whatsapp.logOutboundMessage, {
      businessId: args.businessId,
      customerId: args.customerId,
      content: args.content,
    });
    return { sent: true };
  },
});

export const getCustomerLiteById = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => await ctx.db.get(args.customerId),
});

export const getCustomerByBusinessPhone = query({
  args: { businessId: v.id("businesses"), phone: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("customers")
      .withIndex("by_business_phone", (q) =>
        q.eq("businessId", args.businessId).eq("phone", args.phone)
      )
      .unique();
  },
});

function buildRealtimeAssistantReply(
  customerName: string,
  lastIntent: string | undefined,
  inboundContent: string
): string {
  if (lastIntent === "BUYING_SIGNAL") {
    return `Sure ${customerName}, I can help with that. Tell me the exact item, size, color, or budget you have in mind.`;
  }
  if (lastIntent === "GENERAL_INQUIRY") {
    return `Thanks ${customerName}. What product are you looking for today?`;
  }
  if (/(hello|hi|hey|good morning|good afternoon|good evening)/i.test(inboundContent)) {
    return `Hi ${customerName}, welcome to Pipelixr sales desk. What product are you looking for today?`;
  }
  return `Thanks ${customerName}. I can help you choose quickly and place your order in chat. What are you looking for?`;
}

export const handleRealtimeAssistantReply = action({
  args: {
    businessId: v.id("businesses"),
    sender: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; reason?: string }> => {
    const customer = await ctx.runQuery(api.whatsapp.getCustomerByBusinessPhone, {
      businessId: args.businessId,
      phone: args.sender,
    });

    if (!customer) return { sent: false, reason: "customer_not_found" };
    if (customer.isGroup) return { sent: false, reason: "group_chat_not_supported" };

    const recentOutbound = await ctx.runQuery(api.whatsapp.getRecentOutboundForCustomer, {
      customerId: customer._id,
      since: Date.now() - 2 * 60 * 1000,
    });
    if (recentOutbound > 0) return { sent: false, reason: "cooldown_active" };

    const allowed = await ctx.runQuery(api.whatsapp.canSendToCustomerNow, {
      businessId: args.businessId,
      customerId: customer._id,
    });
    if (!allowed) return { sent: false, reason: "guardrail_blocked" };

    const customerName = customer.name || customer.phone.split("@")[0];
    const message = buildRealtimeAssistantReply(customerName, customer.lastIntent, args.content);
    const result = await ctx.runAction(api.whatsapp.sendRetargetMessage, {
      businessId: args.businessId,
      customerId: customer._id,
      content: message,
    });
    return result?.sent ? { sent: true } : { sent: false, reason: "send_failed" };
  },
});

export const getRecentOutboundForCustomer = query({
  args: {
    customerId: v.id("customers"),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("interactions")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .filter((q) =>
        q.and(
          q.eq(q.field("role"), "owner"),
          q.gt(q.field("timestamp"), args.since)
        )
      )
      .collect();
    return recent.length;
  },
});

export const getOrderSuggestion = query({
  args: { businessId: v.id("businesses"), customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId) return null;
    const topic = customer.memoryLastAskedTopic || "product details";
    const category = customer.memoryPreferredCategory || "best sellers";
    const objection = customer.memoryLastObjection;

    return {
      suggestedReply: objection === "price"
        ? "I can share a lower-price option and current promo. What budget should we target?"
        : `Thanks for your interest. I can send details on ${topic} right away.`,
      suggestedUpsell: `Offer a matching add-on from ${category}.`,
      suggestedFollowUpTiming: customer.lastInboundAt ? "Follow up in 2-4 hours if no response." : "Follow up in 12 hours.",
    };
  },
});

export const getDueAutomationRuns = query({
  args: { businessId: v.id("businesses"), now: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("automationRuns")
      .withIndex("by_business_status", (q) => q.eq("businessId", args.businessId).eq("status", "pending"))
      .filter((q) => q.lte(q.field("scheduledAt"), args.now))
      .collect();
  },
});

export const getAutomationRunById = query({
  args: { runId: v.id("automationRuns") },
  handler: async (ctx, args) => await ctx.db.get(args.runId),
});

export const getTemplateById = query({
  args: { templateId: v.id("messageTemplates") },
  handler: async (ctx, args) => await ctx.db.get(args.templateId),
});

export const markAutomationRunRunning = mutation({
  args: { runId: v.id("automationRuns") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, { status: "running" });
  },
});

export const finishAutomationRun = mutation({
  args: { runId: v.id("automationRuns"), sentCount: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: "completed",
      sentCount: args.sentCount,
      executedAt: Date.now(),
    });
  },
});

export const logOutboundMessage = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("interactions", {
      businessId: args.businessId,
      customerId: args.customerId,
      role: "owner",
      content: args.content,
      timestamp: Date.now(),
      messageType: "text",
    });
    await ctx.db.patch(args.customerId, {
      lastOutboundAt: Date.now(),
      funnelStage: "engaged",
      memorySummaryUpdatedAt: Date.now(),
    });
  },
});

export const canSendToCustomerNow = query({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
  },
  handler: async (ctx, args) => {
    const now = new Date();
    const hour = now.getHours();
    if (hour < 7 || hour >= 22) return false;

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const messages = await ctx.db
      .query("interactions")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .filter((q) => q.and(q.eq(q.field("role"), "owner"), q.gt(q.field("timestamp"), since)))
      .collect();
    if (messages.length >= 3) return false;

    const businessMsgs = await ctx.db
      .query("interactions")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .filter((q) => q.and(q.eq(q.field("role"), "owner"), q.gt(q.field("timestamp"), since)))
      .collect();
    if (businessMsgs.length >= 250) return false;

    return true;
  },
});

function buildSuggestedMessage(lastIntent: string | undefined, customerName: string): string {
  if (lastIntent === "BUYING_SIGNAL") {
    return `Hi ${customerName}, quick follow-up: should I send the best option in your budget?`;
  }
  return `Hi ${customerName}, still interested? I can help you complete this today.`;
}

function estimateCustomerValue(totalValue: number, lastIntent: string | undefined): number {
  const base = totalValue > 0 ? totalValue : DEFAULT_ESTIMATED_ORDER_VALUE;
  if (lastIntent === "BUYING_SIGNAL") return base;
  return Math.round(base * 0.5);
}

function computeBasePriorityScore(
  now: number,
  lastInteraction: number,
  lastOutboundAt: number | undefined,
  funnelStage: string | undefined,
  lastIntent: string | undefined
): number {
  const inactivityMs = now - lastInteraction;
  const hoursSilent = inactivityMs / (1000 * 60 * 60);
  const isHot = funnelStage === "awaiting_payment";
  const isWarm = lastIntent === "BUYING_SIGNAL" || funnelStage === "intent";
  const shouldReplyNow = isHot && (!lastOutboundAt || (now - lastOutboundAt) > 90 * 60 * 1000);
  const urgencyBoost = shouldReplyNow ? 8 : 0;
  return (isHot ? 80 : isWarm ? 50 : 25) + Math.min(Math.round(hoursSilent * 2), 30) + urgencyBoost;
}

export const getInvisibleCrmOverview = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
      .take(300);

    const now = Date.now();
    let hotLeads = 0;
    let stalledAfterQuote = 0;
    let unattendedHotLeads = 0;
    let potentialRevenueAtRisk = 0;

    for (const customer of customers) {
      const isHot = customer.lastIntent === "BUYING_SIGNAL" || customer.funnelStage === "awaiting_payment";
      const isStalled = customer.lastIntent === "BUYING_SIGNAL" && !!customer.lastInboundAt && (now - customer.lastInboundAt) > 12 * 60 * 60 * 1000;
      const unattended = isHot && (!customer.lastOutboundAt || (now - customer.lastOutboundAt) > 2 * 60 * 60 * 1000);

      if (isHot) hotLeads += 1;
      if (isStalled) stalledAfterQuote += 1;
      if (unattended) unattendedHotLeads += 1;
      if (isHot || isStalled) potentialRevenueAtRisk += estimateCustomerValue(customer.totalValue, customer.lastIntent);
    }

    return {
      hotLeads,
      stalledAfterQuote,
      unattendedHotLeads,
      potentialRevenueAtRisk,
    };
  },
});

export const getRevenueActionFeed = query({
  args: { businessId: v.id("businesses"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(250);

    const now = Date.now();
    const limit = Math.min(args.limit || 25, 50);
    const outcomes = await ctx.db
      .query("actionOutcomes")
      .withIndex("by_business_sent", (q) => q.eq("businessId", args.businessId))
      .collect();

    const intentPerformance = new Map<string, { sent: number; won: number }>();
    for (const outcome of outcomes) {
      const key = outcome.initialIntent || "general";
      const current = intentPerformance.get(key) || { sent: 0, won: 0 };
      current.sent += 1;
      if (outcome.status === "won") current.won += 1;
      intentPerformance.set(key, current);
    }

    const actions = customers.map((customer) => {
      const inactivityMs = now - (customer.lastInteraction || now);
      const hoursSilent = inactivityMs / (1000 * 60 * 60);
      const isHot = customer.funnelStage === "awaiting_payment";
      const isWarm = customer.lastIntent === "BUYING_SIGNAL" || customer.funnelStage === "intent";

      const shouldReplyNow = isHot && (!customer.lastOutboundAt || (now - customer.lastOutboundAt) > 90 * 60 * 1000);
      const shouldNudge = isWarm && hoursSilent > 6;
      const baseScore = computeBasePriorityScore(
        now,
        customer.lastInteraction || now,
        customer.lastOutboundAt,
        customer.funnelStage,
        customer.lastIntent
      );
      const performance = intentPerformance.get(customer.lastIntent || "general");
      const learningBoost =
        performance && performance.sent >= 5
          ? Math.max(-10, Math.min(12, Math.round(((performance.won / performance.sent) - 0.3) * 40)))
          : 0;
      const priorityScore = baseScore + learningBoost;
      const priority = priorityScore >= 90 ? "high" : priorityScore >= 60 ? "medium" : "low";
      const customerName = customer.name || customer.phone.split("@")[0];

      let reason = "Re-engage inactive lead";
      if (shouldReplyNow) reason = "Hot lead waiting for response";
      if (customer.lastIntent === "BUYING_SIGNAL") reason = "Buying signal detected";
      if (shouldNudge && customer.lastIntent === "BUYING_SIGNAL") reason = "Asked to buy, no follow-up yet";

      return {
        customerId: customer._id,
        customerName,
        customerPhone: customer.phone,
        priority,
        reason,
        suggestedMessage: buildSuggestedMessage(customer.lastIntent, customerName),
        dueAt: now,
        estimatedValue: estimateCustomerValue(customer.totalValue, customer.lastIntent),
        priorityScore,
      };
    });

    return actions
      .filter((a) => a.priorityScore >= 55)
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, limit)
      .map(({ priorityScore: _, ...rest }) => rest);
  },
});

export const executeRevenueAction = action({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; reason?: string }> => {
    const allowed = await ctx.runQuery(api.whatsapp.canSendToCustomerNow, {
      businessId: args.businessId,
      customerId: args.customerId,
    });

    if (!allowed) {
      return { sent: false, reason: "send_limit_guardrail" };
    }

    const customer = await ctx.runQuery(api.whatsapp.getCustomerLiteById, {
      customerId: args.customerId,
    });
    if (!customer || customer.businessId !== args.businessId) {
      return { sent: false, reason: "customer_not_found" };
    }

    const result = await ctx.runAction(api.whatsapp.sendRetargetMessage, {
      businessId: args.businessId,
      customerId: args.customerId,
      content: args.message,
    });
    if (!result?.sent) return { sent: false, reason: "send_failed" };

    const scoreAtSend = computeBasePriorityScore(
      Date.now(),
      customer.lastInteraction || Date.now(),
      customer.lastOutboundAt,
      customer.funnelStage,
      customer.lastIntent
    );
    await ctx.runMutation(api.whatsapp.logActionOutcomeSent, {
      businessId: args.businessId,
      customerId: args.customerId,
      suggestedMessage: args.message,
      initialIntent: customer.lastIntent,
      scoreAtSend,
      estimatedValue: estimateCustomerValue(customer.totalValue, customer.lastIntent),
    });

    return { sent: true };
  },
});

export const logActionOutcomeSent = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    suggestedMessage: v.string(),
    initialIntent: v.optional(v.string()),
    scoreAtSend: v.number(),
    estimatedValue: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("actionOutcomes", {
      businessId: args.businessId,
      customerId: args.customerId,
      status: "sent",
      actionType: "follow_up",
      suggestedMessage: args.suggestedMessage,
      initialIntent: args.initialIntent,
      scoreAtSend: args.scoreAtSend,
      estimatedValue: args.estimatedValue,
      sentAt: Date.now(),
    });
  },
});

export const markActionOutcomeClosed = mutation({
  args: {
    businessId: v.id("businesses"),
    outcomeId: v.id("actionOutcomes"),
    status: v.union(v.literal("won"), v.literal("lost")),
    outcomeValue: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const outcome = await ctx.db.get(args.outcomeId);
    if (!outcome || outcome.businessId !== args.businessId) {
      throw new Error("Outcome not found");
    }

    await ctx.db.patch(args.outcomeId, {
      status: args.status,
      closedAt: Date.now(),
      outcomeValue: args.outcomeValue,
    });
  },
});

export const getRecentActionOutcomes = query({
  args: { businessId: v.id("businesses"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit || 30, 100);
    const outcomes = await ctx.db
      .query("actionOutcomes")
      .withIndex("by_business_sent", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(limit);

    const result = [];
    for (const outcome of outcomes) {
      const customer = await ctx.db.get(outcome.customerId);
      result.push({
        ...outcome,
        customerName: customer?.name || customer?.phone || "Unknown",
      });
    }
    return result;
  },
});

export const getRevenueLoopMetrics = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const outcomes = await ctx.db
      .query("actionOutcomes")
      .withIndex("by_business_sent", (q) => q.eq("businessId", args.businessId))
      .collect();

    const totalSent = outcomes.length;
    const replied = outcomes.filter((o) => o.status === "replied" || o.status === "won" || o.status === "lost").length;
    const won = outcomes.filter((o) => o.status === "won").length;
    const recoveredRevenue = outcomes
      .filter((o) => o.status === "won")
      .reduce((sum, o) => sum + (o.outcomeValue || o.estimatedValue || 0), 0);

    return {
      totalSent,
      replyRate: totalSent > 0 ? replied / totalSent : 0,
      winRate: totalSent > 0 ? won / totalSent : 0,
      recoveredRevenue,
    };
  },
});

export const getMvpRevenueMetrics = query({
  args: {
    businessId: v.id("businesses"),
    period: v.optional(v.union(v.literal("today"), v.literal("week"), v.literal("month"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const periodStart = args.period === "today"
      ? (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })()
      : args.period === "week"
        ? now - 7 * 24 * 60 * 60 * 1000
        : args.period === "month"
          ? now - 30 * 24 * 60 * 60 * 1000
          : 0;

    const allTasks = await ctx.db
      .query("followUpTasks")
      .withIndex("by_business_due", (q) => q.eq("businessId", args.businessId))
      .filter((q) => q.eq(q.field("reason"), "buying_signal"))
      .collect();

    const tasks = periodStart > 0
      ? allTasks.filter((t) => t.createdAt >= periodStart)
      : allTasks;

    const totalSignals = tasks.length;
    const replied = tasks.filter((t) => t.status === "cancelled").length;
    const followedUp = tasks.filter((t) => t.status === "done").length;
    const lost = tasks.filter((t) => t.status === "skipped").length;

    // Use owner-configured AOV if set, else fall back to order history average
    const biz = await ctx.db.get(args.businessId);
    let aov = biz?.averageOrderValue ?? 0;
    if (!aov) {
      const orders = await ctx.db
        .query("orders")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .collect();
      aov = orders.length > 0
        ? Math.round(orders.reduce((sum, o) => sum + o.totalAmount, 0) / orders.length)
        : DEFAULT_ESTIMATED_ORDER_VALUE;
    }

    return {
      totalSignals,
      replied,
      followedUp,
      lost,
      estimatedLostRevenue: lost * aov,
    };
  },
});

/** Provisions a new Evolution Go instance for a business and sets the webhook. */
export const provisionEvolutionGoInstance = action({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<{ instanceName: string }> => {
    const business = await ctx.runQuery(api.whatsapp.getBusinessForAssistantAuth, {
      businessId: args.businessId,
    });
    const instanceName = business?.evolutionInstanceName || getEvolutionInstanceName(business?.name || "pipelixr", args.businessId);
    let instanceId = business?.evolutionInstanceId || evoClient.generateEvolutionInstanceId();
    const preferredNumber = business?.assistantAdminPhones?.[0];
    const webhookUrl = evoClient.getEvolutionWebhookUrl();
    const subscribedEvents = ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT"];

    await ctx.runMutation(api.businesses.setEvolutionInstance, {
      businessId: args.businessId,
      instanceName,
      instanceId,
    });

    let existingRecord = await evoClient.getInstanceRecord(instanceId);
    if (!existingRecord) {
      existingRecord = await evoClient.getInstanceRecord(instanceName);
    }
    const disconnectReason = String(
      (existingRecord as Record<string, any> | null)?.disconnect_reason ||
      (existingRecord as Record<string, any> | null)?.disconnectReason ||
      ""
    );
    const needsFreshInstance = /qr code limit reached/i.test(disconnectReason);

    if (needsFreshInstance) {
      console.warn(`[provisionEvolutionGoInstance] ${instanceName} is stale (${disconnectReason}); recreating it.`);
      await evoClient.deleteInstanceSilently(instanceName);
      await evoClient.deleteInstanceSilently(instanceId);
      instanceId = evoClient.generateEvolutionInstanceId();
      await ctx.runMutation(api.businesses.setEvolutionInstance, {
        businessId: args.businessId,
        instanceName,
        instanceId,
      });
    }

    const exists = await evoClient.instanceExists(instanceId);
    let initialQr: string | null = null;
    let pairingCode: string | null = null;
    let currentState = "close";

    console.log(`[provisionEvolutionGoInstance] starting for ${instanceName}`);

    try {
      currentState = await evoClient.getConnectionState(instanceId);
    } catch (e: any) {
      try {
        currentState = await evoClient.getConnectionState(instanceName);
      } catch (fallbackError: any) {
        console.warn("[provisionEvolutionGoInstance] getConnectionState error:", fallbackError?.message || e?.message);
      }
    }
    console.log(`[provisionEvolutionGoInstance] ${instanceName} exists=${exists} state=${currentState}`);

    if (exists && currentState === "open") {
      console.warn(`[provisionEvolutionGoInstance] Instance ${instanceName} is already connected; skipping QR provisioning.`);
      await ctx.runMutation(api.businesses.setEvolutionInstance, {
        businessId: args.businessId,
        instanceName,
      });
      await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
        businessId: args.businessId,
        status: "connected",
      });
      return { instanceName };
    }

    if (exists) {
      console.warn(`[provisionEvolutionGoInstance] Instance ${instanceName} exists with state ${currentState}; reusing it and asking Evolution Go to connect.`);
    }

    if (!exists) {
      try {
        const created = await evoClient.createInstance(instanceName, {
          displayName: business?.name || instanceName,
          instanceId,
        });
        initialQr = created.qrCode;
        pairingCode = created.pairingCode;
        console.log(`[provisionEvolutionGoInstance] createInstance result for ${instanceName}`, {
          hasQr: !!initialQr,
          hasPairingCode: !!pairingCode,
        });
      } catch (e: any) {
        const message = e?.message || "";
        if (!message.toLowerCase().includes("already exists")) {
          console.warn("[provisionEvolutionGoInstance] createInstance error:", message);
        } else {
          console.warn(`[provisionEvolutionGoInstance] Instance ${instanceName} already exists during create; continuing.`);
        }
      }
    }

    try {
      const connectResult = await evoClient.connectInstance(instanceName, {
        instanceId,
        webhookUrl: webhookUrl || undefined,
        subscribe: subscribedEvents,
      });
      console.log(`[provisionEvolutionGoInstance] connectInstance result for ${instanceName}`, connectResult);
    } catch (e: any) {
      console.warn("[provisionEvolutionGoInstance] connectInstance error:", e?.message);
    }

    if (preferredNumber) {
      try {
        const pairResult = await evoClient.pairInstance(instanceName, preferredNumber, {
          instanceId,
          subscribe: subscribedEvents,
        });
        console.log(`[provisionEvolutionGoInstance] pairInstance result for ${instanceName}`, pairResult);
        if (pairResult.pairingCode) {
          pairingCode = pairResult.pairingCode;
        }
      } catch (e: any) {
        console.warn("[provisionEvolutionGoInstance] pairInstance error:", e?.message);
      }
    }

    // Poll for a short window so we capture the QR once the instance finishes booting.
    try {
      const connection = await evoClient.waitForConnectionArtifacts(instanceId);
      console.log(`[provisionEvolutionGoInstance] waitForConnectionArtifacts result for ${instanceName}`, {
        hasQr: !!connection.qrCode,
        hasPairingCode: !!connection.pairingCode,
      });
      if (connection.qrCode) {
        initialQr = connection.qrCode;
      }
      if (connection.pairingCode) {
        pairingCode = connection.pairingCode;
      }
    } catch (e: any) {
      console.warn("[provisionEvolutionGoInstance] getConnectionArtifacts error:", e?.message);
    }

    await ctx.runMutation(api.businesses.setEvolutionInstance, {
      businessId: args.businessId,
      instanceName,
    });
    
    if (initialQr) {
      await ctx.runMutation(api.whatsapp.updateQRCode, {
        businessId: args.businessId,
        qrCodeString: initialQr,
      });
    }
    if (pairingCode) {
      await ctx.runMutation(api.whatsapp.updatePairingCode, {
        businessId: args.businessId,
        pairingCode,
      });
    }
    if (!initialQr && !pairingCode) {
      await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
        businessId: args.businessId,
        status: "pending",
      });
    }

    console.log(`[provisionEvolutionGoInstance] finished for ${instanceName}`, {
      hasQr: !!initialQr,
      hasPairingCode: !!pairingCode,
    });

    return { instanceName };
  },
});

/** Deletes the Evolution Go instance for a business (e.g., on cancellation). */
export const deleteEvolutionGoInstance = action({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<void> => {
    const biz = await ctx.runQuery(api.whatsapp.getBusinessForAssistantAuth, { businessId: args.businessId });
    const instanceName = biz?.evolutionInstanceName || getEvolutionInstanceName(biz?.name || "pipelixr", args.businessId);
    try {
      await evoClient.deleteInstance(instanceName);
    } catch (e) {
      console.warn("[deleteEvolutionGoInstance] Could not delete instance:", e);
    }
    await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
      businessId: args.businessId,
      status: "disconnected",
    });
  },
});


export const setAssistantAdminPhone = mutation({
  args: {
    businessId: v.id("businesses"),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) return;
    const normalized = normalizePhoneForWhatsApp(args.phone);
    const existing = business.assistantAdminPhones || [];
    if (existing.includes(normalized)) return;
    await ctx.db.patch(args.businessId, {
      assistantAdminPhones: [...existing, normalized],
    });
  },
});

function parseOwnerAssistantCommand(content: string): "help" | "today" | "funnel" | "hot" | "revenue" | "actions" | "unknown" {
  const text = content.trim().toLowerCase();
  if (!text) return "unknown";
  if (text === "help" || text.includes("menu")) return "help";
  if (text.includes("today") || text.includes("daily")) return "today";
  if (text.includes("funnel") || text.includes("pipeline")) return "funnel";
  if (text.includes("hot")) return "hot";
  if (text.includes("revenue") || text.includes("sales")) return "revenue";
  if (text.includes("action") || text.includes("follow")) return "actions";
  return "unknown";
}

export const getOwnerAssistantSnapshot = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const since = todayStart.getTime();

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
      .collect();
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();

    const totalLeads = customers.length;
    const hotLeads = customers.filter((c) =>
      c.lastIntent === "BUYING_SIGNAL" ||
      c.funnelStage === "awaiting_payment"
    ).length;
    const todayInbound = customers.filter((c) => (c.lastInboundAt || 0) >= since).length;
    const awaitingPayment = customers.filter((c) => c.funnelStage === "awaiting_payment").length;
    const paid = customers.filter((c) => c.funnelStage === "paid").length;
    const intent = customers.filter((c) => c.funnelStage === "intent").length;
    const engaged = customers.filter((c) => c.funnelStage === "engaged").length;
    const viewers = customers.filter((c) => c.funnelStage === "viewer").length;
    const todayPaidOrders = orders.filter((o) => o.status === "paid" && o.createdAt >= since);
    const todayRevenue = todayPaidOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    const todayOrders = todayPaidOrders.length;

    const actionFeed = await ctx.db
      .query("actionOutcomes")
      .withIndex("by_business_sent", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(50);

    const openActions = actionFeed.filter((a) => a.status === "sent").length;
    const repliedActions = actionFeed.filter((a) => a.status === "replied").length;
    const wonActions = actionFeed.filter((a) => a.status === "won").length;

    return {
      now,
      totalLeads,
      hotLeads,
      todayInbound,
      awaitingPayment,
      paid,
      intent,
      engaged,
      viewers,
      todayOrders,
      todayRevenue,
      openActions,
      repliedActions,
      wonActions,
    };
  },
});

function formatNaira(amount: number): string {
  return `N${Math.round(amount).toLocaleString()}`;
}

function buildOwnerAssistantReply(
  command: ReturnType<typeof parseOwnerAssistantCommand>,
  snapshot: {
    totalLeads: number;
    hotLeads: number;
    todayInbound: number;
    awaitingPayment: number;
    paid: number;
    intent: number;
    engaged: number;
    viewers: number;
    todayOrders: number;
    todayRevenue: number;
    openActions: number;
    repliedActions: number;
    wonActions: number;
  }
): string {
  if (command === "today") {
    return `Pipelixr Daily Report\n- New inbound leads today: ${snapshot.todayInbound}\n- Paid orders today: ${snapshot.todayOrders}\n- Revenue today: ${formatNaira(snapshot.todayRevenue)}\n- Hot leads now: ${snapshot.hotLeads}\n- Awaiting payment: ${snapshot.awaitingPayment}`;
  }
  if (command === "funnel") {
    return `Pipelixr Funnel Snapshot\n- Viewers: ${snapshot.viewers}\n- Engaged: ${snapshot.engaged}\n- Intent: ${snapshot.intent}\n- Awaiting payment: ${snapshot.awaitingPayment}\n- Paid: ${snapshot.paid}\n- Total leads: ${snapshot.totalLeads}`;
  }
  if (command === "hot") {
    return `Pipelixr Hot Leads\n- Hot leads: ${snapshot.hotLeads}\n- Awaiting payment: ${snapshot.awaitingPayment}\n- Open recovery actions: ${snapshot.openActions}\nUse: "actions" to check recovery performance.`;
  }
  if (command === "revenue") {
    return `Pipelixr Revenue Pulse\n- Revenue today: ${formatNaira(snapshot.todayRevenue)}\n- Paid orders today: ${snapshot.todayOrders}\n- Won recoveries: ${snapshot.wonActions}\n- Replied recoveries: ${snapshot.repliedActions}`;
  }
  if (command === "actions") {
    return `Pipelixr Recovery Actions\n- Open sent actions: ${snapshot.openActions}\n- Replied actions: ${snapshot.repliedActions}\n- Won actions: ${snapshot.wonActions}\n- Hot leads pending: ${snapshot.hotLeads}`;
  }
  return `Pipelixr Assistant Commands:\n- today\n- funnel\n- hot\n- revenue\n- actions\n- help`;
}

export const handleOwnerAssistantMessage = action({
  args: {
    businessId: v.id("businesses"),
    sender: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<{ handled: boolean; reason?: string }> => {
    const business = await ctx.runQuery(api.whatsapp.getBusinessForAssistantAuth, {
      businessId: args.businessId,
    });
    if (!business) return { handled: false, reason: "business_not_found" };
    const adminPhones = (business.assistantAdminPhones || []).map(normalizePhoneDigits);
    const senderDigits = normalizePhoneDigits(args.sender);
    if (!senderDigits || !adminPhones.includes(senderDigits)) {
      return { handled: false, reason: "not_admin_sender" };
    }

    const customer = await ctx.runQuery(api.whatsapp.getCustomerByBusinessPhone, {
      businessId: args.businessId,
      phone: args.sender,
    });
    if (!customer) return { handled: false, reason: "chat_not_ready" };

    const command = parseOwnerAssistantCommand(args.content);
    const snapshot = await ctx.runQuery(api.whatsapp.getOwnerAssistantSnapshot, {
      businessId: args.businessId,
    });
    const reply = buildOwnerAssistantReply(command, snapshot);

    const sent = await ctx.runAction(api.whatsapp.sendRetargetMessage, {
      businessId: args.businessId,
      customerId: customer._id,
      content: reply,
    });
    return sent?.sent ? { handled: true } : { handled: false, reason: "send_failed" };
  },
});

export const getBusinessForAssistantAuth = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.businessId);
  },
});
