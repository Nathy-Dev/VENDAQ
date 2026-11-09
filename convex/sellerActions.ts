import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireBusiness } from "./lib/authorization";
import { sha256 } from "./lib/crypto";
import { actionPriority, journeyForOrder, transitionOrder, type OrderStatus } from "./lib/sellerActions";
import type { JourneyStage } from "./lib/journey";
import { foundationPolicy } from "./lib/policy";
import { renderSafeSuggestion, SUGGESTION_VERSION } from "./lib/suggestions";
import { cappedAvailableAt, policyForBusiness } from "./followUps";

const orderStatus = v.union(v.literal("pending"), v.literal("awaiting_payment"), v.literal("paid"), v.literal("payment_failed"), v.literal("expired"), v.literal("processing"), v.literal("shipped"), v.literal("delivered"), v.literal("cancelled"));
const taskReason = v.union(v.literal("buying_signal"), v.literal("asked_no_order"), v.literal("awaiting_payment"));

async function uniqueAction(ctx: MutationCtx, businessId: Id<"businesses">, idempotencyKey: string) {
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(idempotencyKey)) throw new ConvexError({ code: "INVALID_IDEMPOTENCY_KEY" });
  return ctx.db.query("sellerActionEvents").withIndex("by_idempotency", (builder) => builder.eq("businessId", businessId).eq("idempotencyKey", idempotencyKey)).unique();
}

async function cancelOpenTasks(ctx: MutationCtx, customerId: Id<"customers">, reason: string) {
  const tasks = await ctx.db.query("followUpTasks").withIndex("by_customer_status", (builder) => builder.eq("customerId", customerId).eq("status", "pending")).take(foundationPolicy().batchSize);
  for (const task of tasks) await ctx.db.patch(task._id, { status: "cancelled", cancelledAt: Date.now(), cancellationReason: reason });
}

async function createTask(ctx: MutationCtx, args: {
  business: Doc<"businesses">;
  customer: Doc<"customers">;
  conversation: Doc<"conversations">;
  reason: "asked_no_order" | "awaiting_payment";
  actionKey: string;
  triggerInteractionId?: Id<"interactions">;
  orderId?: Id<"orders">;
  triggerAt: number;
  requestedAt: number;
  template: string;
  reasonSnapshot: string;
  expiresAt?: number;
}) {
  const existing = await ctx.db.query("followUpTasks").withIndex("by_business_action_key", (builder) => builder.eq("businessId", args.business._id).eq("actionKey", args.actionKey)).unique();
  if (existing) return existing._id;
  const policy = policyForBusiness(args.business);
  const availableAt = await cappedAvailableAt(ctx, args.business._id, args.requestedAt, policy);
  const draft = renderSafeSuggestion(args.template, args.customer.name);
  return ctx.db.insert("followUpTasks", {
    businessId: args.business._id,
    customerId: args.customer._id,
    reason: args.reason,
    dueAt: availableAt,
    status: "pending",
    createdAt: Date.now(),
    conversationId: args.conversation._id,
    ...(args.triggerInteractionId ? { triggerInteractionId: args.triggerInteractionId } : {}),
    ...(args.orderId ? { orderId: args.orderId } : {}),
    triggerAt: args.triggerAt,
    conversationRevision: args.conversation.revision,
    journeyStage: args.customer.funnelStage ?? "engaged",
    draftText: draft.text,
    draftSource: "template",
    draftVersion: SUGGESTION_VERSION,
    draftHash: await sha256(draft.text),
    aiState: "disabled",
    ...(draft.validationCode ? { guardrailCode: draft.validationCode } : {}),
    availableAt,
    ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
    actionKey: args.actionKey,
    estimatedValue: args.business.averageOrderValue ?? 0,
    priorityScore: actionPriority(args.reason, availableAt, Date.now()),
    reasonSnapshot: args.reasonSnapshot,
    policySnapshot: policy,
  });
}

export async function createStalledInquiryTask(ctx: MutationCtx, args: { businessId: Id<"businesses">; customerId: Id<"customers">; conversationId: Id<"conversations">; interactionId: Id<"interactions"> }) {
  const [business, customer, conversation, interaction] = await Promise.all([ctx.db.get(args.businessId), ctx.db.get(args.customerId), ctx.db.get(args.conversationId), ctx.db.get(args.interactionId)]);
  if (!business || !customer || !conversation || !interaction || customer.deletedAt !== undefined) return null;
  if (customer.businessId !== business._id || conversation.businessId !== business._id || interaction.businessId !== business._id || interaction.role !== "customer") return null;
  const delay = (business.stalledOpportunityMinutes ?? foundationPolicy().stalledOpportunityMinutes) * 60000;
  return createTask(ctx, { business, customer, conversation, reason: "asked_no_order", actionKey: `stalled:${interaction._id}`, triggerInteractionId: interaction._id, triggerAt: interaction.timestamp, requestedAt: interaction.timestamp + delay, template: "Hi {name}, thanks for your question. Do you still need help deciding?", reasonSnapshot: "Customer asked a question and the conversation later went quiet.", expiresAt: interaction.expiresAt });
}

async function createPaymentTask(ctx: MutationCtx, order: Doc<"orders">) {
  const [business, customer] = await Promise.all([ctx.db.get(order.businessId), ctx.db.get(order.customerId)]);
  if (!business || !customer || customer.deletedAt !== undefined) return null;
  const conversation = await ctx.db.query("conversations").withIndex("by_customer", (builder) => builder.eq("customerId", customer._id)).unique();
  if (!conversation || conversation.businessId !== business._id) return null;
  const delay = (business.paymentReminderMinutes ?? foundationPolicy().paymentReminderMinutes) * 60000;
  return createTask(ctx, { business, customer, conversation, reason: "awaiting_payment", actionKey: `payment:${order._id}`, orderId: order._id, triggerAt: order.updatedAt ?? order.createdAt, requestedAt: (order.updatedAt ?? order.createdAt) + delay, template: "Hi {name}, just checking whether you still need help completing your order.", reasonSnapshot: "Seller recorded an order as awaiting payment." });
}

async function createAttribution(ctx: MutationCtx, order: Doc<"orders">) {
  if (!order.sourceTaskId || order.status !== "paid" || !order.paidAt) return null;
  const existing = await ctx.db.query("revenueAttributions").withIndex("by_order", (builder) => builder.eq("orderId", order._id)).unique();
  if (existing) return existing._id;
  const task = await ctx.db.get(order.sourceTaskId);
  if (!task || task.businessId !== order.businessId || task.customerId !== order.customerId || !task.opportunityId || !task.manuallySentAt) return null;
  // One seller-recorded follow-up can support at most one recovered-revenue
  // claim, preventing repeated orders from inflating the same intervention.
  const taskAttribution = await ctx.db.query("revenueAttributions").withIndex("by_task", (builder) => builder.eq("taskId", task._id)).first();
  if (taskAttribution) return taskAttribution._id;
  const business = await ctx.db.get(order.businessId);
  if (!business) return null;
  const windowDays = business.attributionWindowDays ?? foundationPolicy().attributionWindowDays;
  const qualifies = order.paidAt > task.manuallySentAt && order.paidAt <= task.manuallySentAt + windowDays * 86400000;
  return ctx.db.insert("revenueAttributions", {
    businessId: order.businessId,
    customerId: order.customerId,
    taskId: task._id,
    orderId: order._id,
    opportunityId: task.opportunityId,
    manualSentAt: task.manuallySentAt,
    orderWonAt: order.paidAt,
    windowDays,
    claimedValue: qualifies ? order.totalAmount : 0,
    confirmedValue: 0,
    evidenceLevel: "seller_recorded",
    state: qualifies ? "claimed" : "rejected",
    reason: qualifies ? "Seller-recorded paid order within the configured window after a seller-recorded manual follow-up." : "Order did not meet the configured seller-recorded attribution window.",
    createdAt: Date.now(),
  });
}

export const actionQueue = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ taskId: v.id("followUpTasks"), customerId: v.id("customers"), customerName: v.string(), identity: v.string(), reason: taskReason, reasonText: v.string(), journeyStage: v.string(), triggerMessage: v.string(), draftText: v.string(), availableAt: v.number(), priorityScore: v.number(), estimatedValue: v.number(), routablePhone: v.union(v.string(), v.null()), sourceTaskHasSendClaim: v.boolean() })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const now = Date.now();
    const tasks = await ctx.db.query("followUpTasks").withIndex("by_business_status_available", (builder) => builder.eq("businessId", args.businessId).eq("status", "pending").lte("availableAt", now)).take(100);
    const rows = [] as Array<{ taskId: Id<"followUpTasks">; customerId: Id<"customers">; customerName: string; identity: string; reason: "buying_signal" | "asked_no_order" | "awaiting_payment"; reasonText: string; journeyStage: string; triggerMessage: string; draftText: string; availableAt: number; priorityScore: number; estimatedValue: number; routablePhone: string | null; sourceTaskHasSendClaim: boolean }>;
    for (const task of tasks) {
      if (task.reason === "viewed_no_dm" || !task.availableAt || !task.draftText) continue;
      const customer = await ctx.db.get(task.customerId);
      if (!customer || customer.businessId !== args.businessId || customer.deletedAt !== undefined) continue;
      const interaction = task.triggerInteractionId ? await ctx.db.get(task.triggerInteractionId) : null;
      const routablePhone = /^(\d+)@s\.whatsapp\.net$/.exec(customer.phone)?.[1] ?? null;
      rows.push({ taskId: task._id, customerId: customer._id, customerName: customer.name ?? "Unnamed customer", identity: customer.phone, reason: task.reason, reasonText: task.reasonSnapshot ?? (task.reason === "buying_signal" ? "Buying signal exceeded the response window." : task.reason === "awaiting_payment" ? "Order is awaiting payment." : "Conversation went quiet after an inquiry."), journeyStage: task.journeyStage ?? customer.funnelStage ?? "engaged", triggerMessage: interaction?.content ?? "Seller-recorded order state", draftText: task.draftText, availableAt: task.availableAt, priorityScore: actionPriority(task.reason, task.availableAt, now), estimatedValue: task.estimatedValue ?? 0, routablePhone, sourceTaskHasSendClaim: task.manuallySentAt !== undefined });
    }
    return rows.sort((left, right) => right.priorityScore - left.priorityScore || left.availableAt - right.availableAt);
  },
});

export const digestPreview = query({
  args: { businessId: v.id("businesses") },
  returns: v.object({ generatedAt: v.number(), text: v.string(), count: v.number() }),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const now = Date.now();
    const tasks = await ctx.db.query("followUpTasks").withIndex("by_business_status_available", (builder) => builder.eq("businessId", args.businessId).eq("status", "pending").lte("availableAt", now)).take(10);
    const lines = ["PIPELIXR action digest"];
    for (const task of tasks) {
      const customer = await ctx.db.get(task.customerId);
      if (customer && task.reason !== "viewed_no_dm") lines.push(`• ${customer.name ?? "Unnamed customer"}: ${task.reasonSnapshot ?? task.reason.replaceAll("_", " ")}`);
    }
    if (lines.length === 1) lines.push("No actions are due.");
    return { generatedAt: now, text: lines.join("\n"), count: lines.length - 1 };
  },
});

export const recordManualSend = mutation({
  args: { businessId: v.id("businesses"), taskId: v.id("followUpTasks"), idempotencyKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    if (await uniqueAction(ctx, args.businessId, args.idempotencyKey)) return null;
    const task = await ctx.db.get(args.taskId);
    if (!task || task.businessId !== args.businessId || task.status !== "pending" || !task.availableAt || task.availableAt > Date.now() || !task.draftHash) throw new ConvexError({ code: "TASK_NOT_ACTIONABLE" });
    if (task.conversationId) {
      const conversation = await ctx.db.get(task.conversationId);
      if (!conversation || conversation.revision !== task.conversationRevision) throw new ConvexError({ code: "STALE_TASK" });
    }
    const at = Date.now();
    await ctx.db.patch(task._id, { status: "done", completedAt: at, manuallySentAt: at, sellerApprovedDraftHash: task.draftHash });
    await ctx.db.insert("sellerActionEvents", { businessId: args.businessId, customerId: task.customerId, taskId: task._id, ...(task.orderId ? { orderId: task.orderId } : {}), type: "manual_send_claim", idempotencyKey: args.idempotencyKey, at });
    return null;
  },
});

export const skipTask = mutation({
  args: { businessId: v.id("businesses"), taskId: v.id("followUpTasks"), idempotencyKey: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    if (await uniqueAction(ctx, args.businessId, args.idempotencyKey)) return null;
    const task = await ctx.db.get(args.taskId);
    if (!task || task.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    const at = Date.now();
    if (task.status === "pending") await ctx.db.patch(task._id, { status: "skipped", completedAt: at });
    await ctx.db.insert("sellerActionEvents", { businessId: args.businessId, customerId: task.customerId, taskId: task._id, type: "task_skipped", idempotencyKey: args.idempotencyKey, at });
    return null;
  },
});

export const markLost = mutation({
  args: { businessId: v.id("businesses"), taskId: v.id("followUpTasks"), idempotencyKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    if (await uniqueAction(ctx, args.businessId, args.idempotencyKey)) return null;
    const task = await ctx.db.get(args.taskId);
    if (!task || task.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    const customer = await ctx.db.get(task.customerId);
    if (!customer || customer.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    const at = Date.now();
    await ctx.db.patch(task._id, { status: task.status === "pending" ? "skipped" : task.status, outcome: "lost", outcomeAt: at, completedAt: task.completedAt ?? at });
    if (customer.funnelStage !== "paid") await ctx.db.patch(customer._id, { funnelStage: "lost" });
    await ctx.db.insert("sellerActionEvents", { businessId: args.businessId, customerId: task.customerId, taskId: task._id, ...(task.orderId ? { orderId: task.orderId } : {}), type: "outcome_lost", idempotencyKey: args.idempotencyKey, value: task.estimatedValue ?? 0, at });
    return null;
  },
});

export const createOrder = mutation({
  args: { businessId: v.id("businesses"), customerId: v.id("customers"), sourceTaskId: v.optional(v.id("followUpTasks")), totalAmount: v.number(), status: v.union(v.literal("pending"), v.literal("awaiting_payment"), v.literal("paid")), idempotencyKey: v.string() },
  returns: v.id("orders"),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const existing = await uniqueAction(ctx, args.businessId, args.idempotencyKey);
    if (existing?.orderId) return existing.orderId;
    if (!Number.isSafeInteger(args.totalAmount) || args.totalAmount <= 0 || args.totalAmount > 1_000_000_000) throw new ConvexError({ code: "INVALID_ORDER_VALUE" });
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId || customer.deletedAt !== undefined) throw new ConvexError({ code: "NOT_FOUND" });
    if (args.sourceTaskId) {
      const task = await ctx.db.get(args.sourceTaskId);
      if (!task || task.businessId !== args.businessId || task.customerId !== customer._id) throw new ConvexError({ code: "NOT_FOUND" });
    }
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", { businessId: args.businessId, customerId: customer._id, items: [], totalAmount: args.totalAmount, status: args.status, createdAt: now, updatedAt: now, ...(args.sourceTaskId ? { sourceTaskId: args.sourceTaskId } : {}), ...(args.status === "paid" ? { paidAt: now } : {}) });
    await ctx.db.patch(customer._id, { funnelStage: journeyForOrder((customer.funnelStage ?? "viewer") as JourneyStage, args.status), totalValue: customer.totalValue + args.totalAmount, tags: customer.tags.includes("customer") ? customer.tags : [...customer.tags, "customer"] });
    if (args.sourceTaskId) await ctx.db.patch(args.sourceTaskId, { orderId, outcome: args.status === "paid" ? "won" : undefined, ...(args.status === "paid" ? { outcomeAt: now } : {}) });
    await ctx.db.insert("sellerActionEvents", { businessId: args.businessId, customerId: customer._id, ...(args.sourceTaskId ? { taskId: args.sourceTaskId } : {}), orderId, type: "order_created", idempotencyKey: args.idempotencyKey, value: args.totalAmount, at: now });
    // Close older opportunities before creating an awaiting-payment reminder so
    // the new order action remains available to the seller.
    await cancelOpenTasks(ctx, customer._id, "ORDER_CREATED");
    const order = await ctx.db.get(orderId);
    if (order?.status === "awaiting_payment") await createPaymentTask(ctx, order);
    if (order?.status === "paid") await createAttribution(ctx, order);
    return orderId;
  },
});

export const updateOrderStatus = mutation({
  args: { businessId: v.id("businesses"), orderId: v.id("orders"), status: orderStatus, idempotencyKey: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    if (await uniqueAction(ctx, args.businessId, args.idempotencyKey)) return null;
    const order = await ctx.db.get(args.orderId);
    if (!order || order.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    let status: OrderStatus;
    try { status = transitionOrder(order.status, args.status); } catch { throw new ConvexError({ code: "ILLEGAL_ORDER_TRANSITION" }); }
    const customer = await ctx.db.get(order.customerId);
    if (!customer || customer.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    const now = Date.now();
    await ctx.db.patch(order._id, { status, updatedAt: now, ...(status === "paid" ? { paidAt: now } : {}), ...(["payment_failed", "expired", "cancelled"].includes(status) ? { lostAt: now } : {}) });
    const nextStage = ["payment_failed", "expired", "cancelled"].includes(status) && customer.funnelStage !== "paid" ? "lost" : journeyForOrder((customer.funnelStage ?? "viewer") as JourneyStage, status);
    await ctx.db.patch(customer._id, { funnelStage: nextStage });
    if (order.sourceTaskId) await ctx.db.patch(order.sourceTaskId, { outcome: status === "paid" ? "won" : ["payment_failed", "expired", "cancelled"].includes(status) ? "lost" : undefined, ...((status === "paid" || ["payment_failed", "expired", "cancelled"].includes(status)) ? { outcomeAt: now } : {}) });
    await ctx.db.insert("sellerActionEvents", { businessId: args.businessId, customerId: order.customerId, ...(order.sourceTaskId ? { taskId: order.sourceTaskId } : {}), orderId: order._id, type: status === "paid" ? "outcome_won" : ["payment_failed", "expired", "cancelled"].includes(status) ? "outcome_lost" : "order_status_changed", idempotencyKey: args.idempotencyKey, value: order.totalAmount, at: now });
    if (order.status === "paid" && status === "cancelled") {
      const attribution = await ctx.db.query("revenueAttributions").withIndex("by_order", (builder) => builder.eq("orderId", order._id)).unique();
      if (attribution && attribution.state === "claimed") await ctx.db.patch(attribution._id, { state: "reversed", reason: "Seller later cancelled the seller-recorded paid order; the original claim remains in the audit trail but is excluded from totals." });
    }
    const updated = await ctx.db.get(order._id);
    if (updated?.status === "awaiting_payment") await createPaymentTask(ctx, updated);
    if (updated?.status === "paid") { await cancelOpenTasks(ctx, customer._id, "ORDER_PAID"); await createAttribution(ctx, updated); }
    return null;
  },
});

export const orders = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ orderId: v.id("orders"), customerId: v.id("customers"), customerName: v.string(), totalAmount: v.number(), status: orderStatus, createdAt: v.number(), paidAt: v.union(v.number(), v.null()), sourceTaskId: v.union(v.id("followUpTasks"), v.null()) })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const orders = await ctx.db.query("orders").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(100);
    const rows = [] as Array<{ orderId: Id<"orders">; customerId: Id<"customers">; customerName: string; totalAmount: number; status: OrderStatus; createdAt: number; paidAt: number | null; sourceTaskId: Id<"followUpTasks"> | null }>;
    for (const order of orders) {
      const customer = await ctx.db.get(order.customerId);
      if (customer && customer.businessId === args.businessId) rows.push({ orderId: order._id, customerId: customer._id, customerName: customer.name ?? "Unnamed customer", totalAmount: order.totalAmount, status: order.status, createdAt: order.createdAt, paidAt: order.paidAt ?? null, sourceTaskId: order.sourceTaskId ?? null });
    }
    return rows;
  },
});

export const rebuildStalledTask = internalMutation({
  args: { businessId: v.id("businesses"), customerId: v.id("customers"), conversationId: v.id("conversations"), interactionId: v.id("interactions") },
  returns: v.union(v.id("followUpTasks"), v.null()),
  handler: async (ctx, args) => createStalledInquiryTask(ctx, args),
});
