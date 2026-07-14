/**
 * Pipeline Engine — The Non-Negotiable Revenue Loop
 *
 * Provides:
 *   - Priority Board (hot/cold/lost ranking)
 *   - Full Funnel Metrics (status → view → DM → order → paid)
 *   - Daily Snapshot capture (for time-series tracking)
 *   - Asked-no-order follow-up processor
 *   - Cold viewer decay + lost opportunity tagging
 */

import { v } from "convex/values";
import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";

const DEFAULT_ESTIMATED_ORDER_VALUE = 15000;
const ASKED_NO_ORDER_DELAY_MS = 6 * 60 * 60 * 1000; // 6 hours
const COLD_VIEWER_THRESHOLD_DAYS = 3;
const LOST_OPPORTUNITY_THRESHOLD_DAYS = 7;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. PRIORITY BOARD — Hot leads, cold viewers, lost opportunities
// ═══════════════════════════════════════════════════════════════════════════════

export const getPriorityBoard = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const coldThreshold = now - COLD_VIEWER_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    const lostThreshold = now - LOST_OPPORTUNITY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
      .collect();

    const hotLeads: Array<{
      customerId: string;
      name: string;
      phone: string;
      funnelStage: string;
      lastIntent: string;
      estimatedValue: number;
      hoursSilent: number;
      reason: string;
    }> = [];

    const coldViewers: Array<{
      customerId: string;
      name: string;
      phone: string;
      lastViewedAt: number;
      daysSinceView: number;
      viewCount: number;
    }> = [];

    const lostOpportunities: Array<{
      customerId: string;
      name: string;
      phone: string;
      lastIntent: string;
      estimatedValue: number;
      daysSilent: number;
      reason: string;
    }> = [];

    for (const c of customers) {
      if (c.isGroup) continue;
      const hoursSilent = (now - c.lastInteraction) / (1000 * 60 * 60);
      const daysSilent = hoursSilent / 24;
      const name = c.name || c.phone.split("@")[0];
      const estimatedValue = c.totalValue > 0 ? c.totalValue : DEFAULT_ESTIMATED_ORDER_VALUE;

      // HOT: buying signal or awaiting payment, active in last 48h
      const isHot =
        (c.lastIntent === "BUYING_SIGNAL" || c.funnelStage === "awaiting_payment" || c.funnelStage === "intent") &&
        hoursSilent < 48;

      if (isHot) {
        let reason = "Buying signal detected";
        if (c.funnelStage === "awaiting_payment") reason = "Payment pending";
        if (!c.lastOutboundAt || (now - c.lastOutboundAt) > 2 * 60 * 60 * 1000) {
          reason += " — needs response";
        }
        hotLeads.push({
          customerId: c._id,
          name,
          phone: c.phone,
          funnelStage: c.funnelStage || "engaged",
          lastIntent: c.lastIntent || "unknown",
          estimatedValue,
          hoursSilent: Math.round(hoursSilent * 10) / 10,
          reason,
        });
        continue;
      }

      // LOST: had intent/engagement but went silent for 7+ days
      const hadIntent = c.lastIntent === "BUYING_SIGNAL" || c.funnelStage === "intent" || c.funnelStage === "order_created";
      const wasEngaged = c.funnelStage === "engaged" && c.lastInboundAt;
      if ((hadIntent || wasEngaged) && daysSilent > LOST_OPPORTUNITY_THRESHOLD_DAYS && c.funnelStage !== "paid") {
        let reason = "Went silent after showing interest";
        if (c.funnelStage === "order_created") reason = "Order created but never paid";
        if (c.lastIntent === "BUYING_SIGNAL") reason = "Asked to buy, never converted";
        lostOpportunities.push({
          customerId: c._id,
          name,
          phone: c.phone,
          lastIntent: c.lastIntent || "engaged",
          estimatedValue,
          daysSilent: Math.round(daysSilent),
          reason,
        });
        continue;
      }

      // COLD: viewed status but never DM'd, last view > 3 days ago
      if (c.leadSource === "status_view" && c.funnelStage === "viewer" && c.lastStatusViewedAt) {
        const daysSinceView = (now - c.lastStatusViewedAt) / (1000 * 60 * 60 * 24);
        if (daysSinceView > COLD_VIEWER_THRESHOLD_DAYS) {
          // Count how many status views from this phone
          const views = await ctx.db
            .query("statusViews")
            .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
            .filter((q) => q.eq(q.field("viewerPhone"), c.phone))
            .collect();

          coldViewers.push({
            customerId: c._id,
            name,
            phone: c.phone,
            lastViewedAt: c.lastStatusViewedAt,
            daysSinceView: Math.round(daysSinceView),
            viewCount: views.length,
          });
        }
      }
    }

    // Sort each bucket
    hotLeads.sort((a, b) => a.hoursSilent - b.hoursSilent);
    coldViewers.sort((a, b) => b.viewCount - a.viewCount);
    lostOpportunities.sort((a, b) => b.estimatedValue - a.estimatedValue);

    return {
      hotLeads: hotLeads.slice(0, 25),
      coldViewers: coldViewers.slice(0, 25),
      lostOpportunities: lostOpportunities.slice(0, 25),
      summary: {
        hotCount: hotLeads.length,
        coldCount: coldViewers.length,
        lostCount: lostOpportunities.length,
        totalAtRisk: lostOpportunities.reduce((sum, l) => sum + l.estimatedValue, 0),
        totalHotValue: hotLeads.reduce((sum, l) => sum + l.estimatedValue, 0),
      },
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FULL FUNNEL METRICS — End-to-end conversion tracking
// ═══════════════════════════════════════════════════════════════════════════════

export const getFullFunnelMetrics = query({
  args: {
    businessId: v.id("businesses"),
    period: v.optional(v.union(v.literal("today"), v.literal("week"), v.literal("month"), v.literal("all"))),
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

    // Statuses posted
    const allStatuses = await ctx.db
      .query("statuses")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const statuses = periodStart > 0
      ? allStatuses.filter((s) => s.timestamp >= periodStart)
      : allStatuses;

    // Views
    const allViews = await ctx.db
      .query("statusViews")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const views = periodStart > 0
      ? allViews.filter((v) => v.timestamp >= periodStart)
      : allViews;
    const uniqueViewerPhones = new Set(views.map((v) => v.viewerPhone));

    // DMs started (customers with inbound messages in period)
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
      .collect();
    const dmsStarted = customers.filter((c) =>
      c.lastInboundAt && c.lastInboundAt >= periodStart && !c.isGroup
    ).length;

    // Orders
    const allOrders = await ctx.db
      .query("orders")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const orders = periodStart > 0
      ? allOrders.filter((o) => o.createdAt >= periodStart)
      : allOrders;
    const paidOrders = orders.filter((o) => o.status === "paid" || o.status === "delivered");
    const revenue = paidOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    // Follow-ups sent
    const allTasks = await ctx.db
      .query("followUpTasks")
      .withIndex("by_business_due", (q) => q.eq("businessId", args.businessId))
      .filter((q) => q.eq(q.field("status"), "done"))
      .collect();
    const followUpsSent = periodStart > 0
      ? allTasks.filter((t) => t.createdAt >= periodStart).length
      : allTasks.length;

    // Revenue recovered (from action outcomes marked "won")
    const allOutcomes = await ctx.db
      .query("actionOutcomes")
      .withIndex("by_business_sent", (q) => q.eq("businessId", args.businessId))
      .collect();
    const wonOutcomes = allOutcomes.filter((o) =>
      o.status === "won" && (periodStart === 0 || o.sentAt >= periodStart)
    );
    const revenueRecovered = wonOutcomes.reduce((sum, o) => sum + (o.outcomeValue || o.estimatedValue || 0), 0);

    // Conversion rates
    const viewToConversation = uniqueViewerPhones.size > 0
      ? dmsStarted / uniqueViewerPhones.size
      : 0;
    const conversationToOrder = dmsStarted > 0
      ? orders.length / dmsStarted
      : 0;
    const orderToPayment = orders.length > 0
      ? paidOrders.length / orders.length
      : 0;

    return {
      funnel: {
        statusesPosted: statuses.length,
        totalViews: views.length,
        uniqueViewers: uniqueViewerPhones.size,
        dmsStarted,
        ordersCreated: orders.length,
        paymentsClosed: paidOrders.length,
        revenue,
      },
      conversions: {
        viewToConversation: Math.round(viewToConversation * 100),
        conversationToOrder: Math.round(conversationToOrder * 100),
        orderToPayment: Math.round(orderToPayment * 100),
      },
      recovery: {
        followUpsSent,
        revenueRecovered,
        leadsConverted: wonOutcomes.length,
        missedMoney: allOutcomes
          .filter((o) => o.status === "lost" && (periodStart === 0 || o.sentAt >= periodStart))
          .reduce((sum, o) => sum + (o.estimatedValue || 0), 0),
      },
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DAILY SNAPSHOT — Captures yesterday's metrics for time-series
// ═══════════════════════════════════════════════════════════════════════════════

export const captureDailySnapshot = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const now = new Date();
    // Capture yesterday's data
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0]; // "YYYY-MM-DD"

    // Check if already captured
    const existing = await ctx.db
      .query("dailySnapshots")
      .withIndex("by_business_date", (q) => q.eq("businessId", args.businessId).eq("date", dateStr))
      .first();
    if (existing) return;

    const dayStart = new Date(yesterday);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(yesterday);
    dayEnd.setHours(23, 59, 59, 999);
    const start = dayStart.getTime();
    const end = dayEnd.getTime();

    // Statuses posted yesterday
    const statuses = await ctx.db
      .query("statuses")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const statusesPosted = statuses.filter((s) => s.timestamp >= start && s.timestamp <= end).length;

    // Views yesterday
    const views = await ctx.db
      .query("statusViews")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const dayViews = views.filter((v) => v.timestamp >= start && v.timestamp <= end);
    const uniqueViewers = new Set(dayViews.map((v) => v.viewerPhone)).size;

    // DMs started
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
      .collect();
    const dmsStarted = customers.filter((c) =>
      c.lastInboundAt && c.lastInboundAt >= start && c.lastInboundAt <= end && !c.isGroup
    ).length;

    // Orders yesterday
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const dayOrders = orders.filter((o) => o.createdAt >= start && o.createdAt <= end);
    const paidOrders = dayOrders.filter((o) => o.status === "paid" || o.status === "delivered");
    const revenueCollected = paidOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    // Follow-ups sent
    const tasks = await ctx.db
      .query("followUpTasks")
      .withIndex("by_business_due", (q) => q.eq("businessId", args.businessId))
      .filter((q) => q.eq(q.field("status"), "done"))
      .collect();
    const followUpsSent = tasks.filter((t) => t.createdAt >= start && t.createdAt <= end).length;

    // Revenue recovered
    const outcomes = await ctx.db
      .query("actionOutcomes")
      .withIndex("by_business_sent", (q) => q.eq("businessId", args.businessId))
      .collect();
    const wonYesterday = outcomes.filter((o) =>
      o.status === "won" && o.closedAt && o.closedAt >= start && o.closedAt <= end
    );
    const revenueRecovered = wonYesterday.reduce((sum, o) => sum + (o.outcomeValue || o.estimatedValue || 0), 0);

    // Current state counts
    const hotLeads = customers.filter((c) =>
      (c.lastIntent === "BUYING_SIGNAL" || c.funnelStage === "awaiting_payment") && !c.isGroup
    ).length;
    const coldViewers = customers.filter((c) =>
      c.leadSource === "status_view" && c.funnelStage === "viewer" && !c.isGroup
    ).length;
    const lostOpportunities = customers.filter((c) =>
      c.funnelStage === "lost" && !c.isGroup
    ).length;

    await ctx.db.insert("dailySnapshots", {
      businessId: args.businessId,
      date: dateStr,
      statusesPosted,
      totalViews: dayViews.length,
      uniqueViewers,
      dmsStarted,
      ordersCreated: dayOrders.length,
      paymentsClosed: paidOrders.length,
      revenueCollected,
      followUpsSent,
      revenueRecovered,
      hotLeads,
      coldViewers,
      lostOpportunities,
    });
  },
});

/** Returns historical daily snapshots for charting */
export const getDailySnapshots = query({
  args: {
    businessId: v.id("businesses"),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.days || 14, 90);
    const snapshots = await ctx.db
      .query("dailySnapshots")
      .withIndex("by_business_date", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(limit);
    return snapshots.reverse(); // chronological order
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ASKED-NO-ORDER FOLLOW-UP — Engaged leads who never ordered
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Scans for engaged customers who sent buying signals or inquiries
 * but never progressed to an order. Schedules a follow-up nudge.
 * Called by the cron every 2 hours.
 */
export const detectAskedNoOrder = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const cutoff = now - ASKED_NO_ORDER_DELAY_MS;

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
      .collect();

    let scheduled = 0;
    for (const c of customers) {
      if (c.isGroup) continue;
      // Target: engaged or intent stage, has inbound, last activity > 6h ago, never ordered
      const isTarget =
        (c.funnelStage === "engaged" || c.funnelStage === "intent") &&
        !!c.lastInboundAt &&
        (c.lastInboundAt as number) < cutoff &&
        c.lastIntent === "BUYING_SIGNAL";

      if (!isTarget) continue;

      // Skip if owner already replied recently
      if (c.lastOutboundAt && c.lastInboundAt && c.lastOutboundAt > c.lastInboundAt) continue;

      // Skip if there's already a pending task for this customer
      const existingTask = await ctx.db
        .query("followUpTasks")
        .withIndex("by_customer_reason", (q) => q.eq("customerId", c._id).eq("reason", "asked_no_order"))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .first();
      if (existingTask) continue;

      // Create the follow-up task
      const dueAt = now + 30 * 60 * 1000; // Fire in 30 min
      const taskId = await ctx.db.insert("followUpTasks", {
        businessId: args.businessId,
        customerId: c._id,
        reason: "asked_no_order",
        dueAt,
        status: "pending",
        createdAt: now,
      });

      const scheduledFunctionId = await ctx.scheduler.runAfter(
        30 * 60 * 1000,
        api.pipeline.processAskedNoOrderFollowUp,
        { businessId: args.businessId, customerId: c._id, taskId }
      );
      await ctx.db.patch(taskId, { scheduledFunctionId });
      scheduled++;
    }
    return { scheduled };
  },
});

export const processAskedNoOrderFollowUp = action({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    taskId: v.id("followUpTasks"),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; reason?: string }> => {
    const task = await ctx.runQuery(api.whatsapp.getFollowUpTaskById, { taskId: args.taskId });
    if (!task || task.status !== "pending" || task.reason !== "asked_no_order") {
      return { sent: false, reason: "task_not_pending" };
    }

    // Check if owner already replied
    const ownerReplies = await ctx.runQuery(api.whatsapp.getOwnerRepliesForCustomerSince, {
      customerId: args.customerId,
      since: task.createdAt,
    });
    if (ownerReplies > 0) {
      await ctx.runMutation(api.whatsapp.markTaskCancelled, { taskId: args.taskId });
      return { sent: false, reason: "owner_replied" };
    }

    // Check if customer placed an order since task creation
    const customer = await ctx.runQuery(api.whatsapp.getCustomerLiteById, { customerId: args.customerId });
    if (!customer) {
      await ctx.runMutation(api.whatsapp.markTaskSkipped, { taskId: args.taskId });
      return { sent: false, reason: "customer_not_found" };
    }
    if (customer.funnelStage === "order_created" || customer.funnelStage === "awaiting_payment" || customer.funnelStage === "paid") {
      await ctx.runMutation(api.whatsapp.markTaskCancelled, { taskId: args.taskId });
      return { sent: false, reason: "already_ordered" };
    }

    // Guardrails
    const allowed = await ctx.runQuery(api.whatsapp.canSendToCustomerNow, {
      businessId: args.businessId,
      customerId: args.customerId,
    });
    if (!allowed) {
      await ctx.runMutation(api.whatsapp.markTaskSkipped, { taskId: args.taskId });
      return { sent: false, reason: "guardrail_blocked" };
    }

    // Check if AI is enabled
    const biz = await ctx.runQuery(api.whatsapp.getBusinessForAssistantAuth, { businessId: args.businessId });
    if (biz?.aiEnabled === false) {
      await ctx.runMutation(api.whatsapp.markTaskSkipped, { taskId: args.taskId });
      return { sent: false, reason: "ai_disabled" };
    }

    const customerName = customer.name || customer.phone.split("@")[0];

    // Generate AI follow-up
    const aiReply = await ctx.runAction(api.ai.generateSmartFollowUp, {
      businessId: args.businessId,
      customerId: args.customerId,
      customerName,
      fallbackTemplate: biz?.followUpTemplate,
    });

    const result = await ctx.runAction(api.whatsapp.sendRetargetMessage, {
      businessId: args.businessId,
      customerId: args.customerId,
      content: aiReply.message,
    });

    if (!result?.sent) {
      await ctx.runMutation(api.whatsapp.markTaskSkipped, { taskId: args.taskId });
      return { sent: false, reason: "send_failed" };
    }

    await ctx.runMutation(api.whatsapp.markTaskDone, { taskId: args.taskId });
    await ctx.runMutation(api.whatsapp.logActionOutcomeSent, {
      businessId: args.businessId,
      customerId: args.customerId,
      suggestedMessage: aiReply.message,
      initialIntent: "BUYING_SIGNAL",
      scoreAtSend: 75,
      estimatedValue: customer.totalValue > 0 ? customer.totalValue : DEFAULT_ESTIMATED_ORDER_VALUE,
    });

    return { sent: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. COLD VIEWER DECAY + LOST OPPORTUNITY TAGGING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Runs daily. Tags customers as "lost" if they had buying intent
 * but went completely silent for LOST_OPPORTUNITY_THRESHOLD_DAYS.
 * Also tags repeat cold viewers who were nudged but never responded.
 */
export const tagLostOpportunities = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const lostCutoff = now - LOST_OPPORTUNITY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business_last_interaction", (q) => q.eq("businessId", args.businessId))
      .collect();

    let tagged = 0;
    for (const c of customers) {
      if (c.isGroup) continue;
      if (c.funnelStage === "paid" || c.funnelStage === "lost") continue;

      const hadBuyingIntent = c.lastIntent === "BUYING_SIGNAL" || c.funnelStage === "intent" || c.funnelStage === "order_created";
      const isSilent = c.lastInteraction < lostCutoff;
      const wasNudged = c.lastOutboundAt && c.lastOutboundAt > c.lastInteraction;

      // Tag as lost if: had intent + silent 7d, OR was nudged + no response 7d
      if (hadBuyingIntent && isSilent) {
        await ctx.db.patch(c._id, { funnelStage: "lost" });
        tagged++;
      } else if (wasNudged && isSilent && c.funnelStage === "viewer") {
        await ctx.db.patch(c._id, { funnelStage: "lost" });
        tagged++;
      }
    }
    return { tagged };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. CRON ENTRY POINTS — Called by convex/crons.ts
// ═══════════════════════════════════════════════════════════════════════════════

/** Runs all daily maintenance for every active business */
export const runDailyMaintenance = internalMutation({
  handler: async (ctx) => {
    const businesses = await ctx.db
      .query("businesses")
      .filter((q) => q.eq(q.field("whatsappStatus"), "connected"))
      .collect();

    for (const biz of businesses) {
      // Capture yesterday's snapshot
      await ctx.scheduler.runAfter(0, internal.pipeline.captureDailySnapshot, {
        businessId: biz._id,
      });
      // Tag lost opportunities
      await ctx.scheduler.runAfter(1000, internal.pipeline.tagLostOpportunities, {
        businessId: biz._id,
      });
    }
  },
});

/** Runs asked-no-order detection for every active business */
export const runAskedNoOrderScan = internalMutation({
  handler: async (ctx) => {
    const businesses = await ctx.db
      .query("businesses")
      .filter((q) => q.eq(q.field("whatsappStatus"), "connected"))
      .collect();

    for (const biz of businesses) {
      await ctx.scheduler.runAfter(0, internal.pipeline.detectAskedNoOrder, {
        businessId: biz._id,
      });
    }
  },
});

/** Runs payment follow-ups for every active business */
export const runPaymentFollowUps = internalMutation({
  handler: async (ctx) => {
    const businesses = await ctx.db
      .query("businesses")
      .filter((q) => q.eq(q.field("whatsappStatus"), "connected"))
      .collect();

    for (const biz of businesses) {
      await ctx.scheduler.runAfter(0, api.whatsapp.processPaymentFollowUps, {
        businessId: biz._id,
      });
    }
  },
});

/** Runs scheduled automation runs for every active business */
export const runScheduledAutomations = internalMutation({
  handler: async (ctx) => {
    const businesses = await ctx.db
      .query("businesses")
      .filter((q) => q.eq(q.field("whatsappStatus"), "connected"))
      .collect();

    for (const biz of businesses) {
      await ctx.scheduler.runAfter(0, api.whatsapp.processScheduledAutomationRuns, {
        businessId: biz._id,
      });
    }
  },
});
