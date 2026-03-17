import { v } from "convex/values";
import { mutation, query, action } from "./_generated/server";
import { api } from "./_generated/api";

// This is a placeholder for the logic that will run in n8n or a separate worker
// to ensure Whapi (Unofficial) mode remains safe.
export const enqueueMessage = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    
    if (business?.whatsappMode === "unofficial") {
      // Logic for "unofficial" safety:
      // 1. Check if we sent too many messages recently (Rate Limiting)
      // 2. Add to a "delayed queue" to mimic human typing
      // 3. Ensure no manual message was sent recently
      console.log("Safeguarded message enqueued for unofficial mode:", args.content);
    }
    
    await ctx.db.insert("interactions", {
      businessId: args.businessId,
      customerId: args.customerId,
      content: args.content,
      role: "system",
      timestamp: Date.now(),
    });
  },
});

export const getSafeguardSettings = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    // Return personalized safeguard settings for this business
    return {
      minDelayMs: 1500,
      maxDelayMs: 4000,
      maxMessagesPerMinute: 30,
      typingSpeedCharPerMin: 220
    };
  },
});
