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
