import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Minimum downtime (ms) before creating an alert — PRD: 10 minutes. */
const DISCONNECTION_ALERT_THRESHOLD_MS = 10 * 60 * 1000;

// ── Disconnection Alert Mutations ──

/**
 * Called by checkConnectionHealth when a disconnection is detected.
 * Creates a new alert if none is currently active for this business.
 */
export const createDisconnectionAlert = mutation({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args) => {
    // Don't create duplicates — only one active alert per business
    const existing = await ctx.db
      .query("disconnectionAlerts")
      .withIndex("by_business_status", (q) =>
        q.eq("businessId", args.businessId).eq("status", "active")
      )
      .first();

    if (existing) return existing._id;

    const now = Date.now();
    return await ctx.db.insert("disconnectionAlerts", {
      businessId: args.businessId,
      detectedAt: now,
      status: "active",
      notifiedAt: now,
    });
  },
});

/**
 * Resolves all active alerts for a business when connection is restored.
 */
export const resolveDisconnectionAlerts = mutation({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args) => {
    const activeAlerts = await ctx.db
      .query("disconnectionAlerts")
      .withIndex("by_business_status", (q) =>
        q.eq("businessId", args.businessId).eq("status", "active")
      )
      .collect();

    const now = Date.now();
    for (const alert of activeAlerts) {
      const durationMs = now - alert.detectedAt;
      await ctx.db.patch(alert._id, {
        status: "resolved",
        resolvedAt: now,
        durationMinutes: Math.round(durationMs / 60000),
      });
    }

    return activeAlerts.length;
  },
});

/**
 * Dismisses a specific alert (user clicked "dismiss" in the UI).
 */
export const dismissDisconnectionAlert = mutation({
  args: {
    alertId: v.id("disconnectionAlerts"),
  },
  handler: async (ctx, args) => {
    const alert = await ctx.db.get(args.alertId);
    if (!alert || alert.status !== "active") return;

    await ctx.db.patch(args.alertId, {
      status: "dismissed",
      resolvedAt: Date.now(),
      durationMinutes: Math.round((Date.now() - alert.detectedAt) / 60000),
    });
  },
});

// ── Disconnection Alert Queries ──

/**
 * Returns all active disconnection alerts for a business.
 * Used by the dashboard to show notification banners.
 */
export const getActiveDisconnectionAlerts = query({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("disconnectionAlerts")
      .withIndex("by_business_status", (q) =>
        q.eq("businessId", args.businessId).eq("status", "active")
      )
      .collect();
  },
});

/**
 * Returns recent disconnection alerts (last 7 days) for a business.
 * Used in the settings/notifications page for history.
 */
export const getRecentDisconnectionAlerts = query({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args) => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return await ctx.db
      .query("disconnectionAlerts")
      .withIndex("by_business_detected", (q) =>
        q.eq("businessId", args.businessId).gte("detectedAt", sevenDaysAgo)
      )
      .order("desc")
      .take(20);
  },
});

/**
 * Returns the threshold in milliseconds. Exported so checkConnectionHealth
 * can reference it.
 */
export const ALERT_THRESHOLD_MS = DISCONNECTION_ALERT_THRESHOLD_MS;
