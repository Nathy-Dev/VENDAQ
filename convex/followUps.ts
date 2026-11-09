import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireBusiness } from "./lib/authorization";
import { sha256 } from "./lib/crypto";
import { foundationPolicy } from "./lib/policy";
import { DEFAULT_FOLLOW_UP_TEMPLATE, SUGGESTION_VERSION, localDayBounds, nextAllowedSuggestionAt, renderSafeSuggestion, validateSuggestion, type SuggestionPolicy } from "./lib/suggestions";

const journeyStage = v.union(v.literal("viewer"), v.literal("engaged"), v.literal("intent"), v.literal("order_created"), v.literal("awaiting_payment"), v.literal("paid"), v.literal("lost"));
type QueueRow = {
  taskId: Id<"followUpTasks">;
  customerId: Id<"customers">;
  customerName: string;
  identity: string;
  triggerMessage: string;
  triggerAt: number;
  availableAt: number;
  journeyStage: "viewer" | "engaged" | "intent" | "order_created" | "awaiting_payment" | "paid" | "lost";
  draftText: string;
  draftSource: "template" | "ai";
  aiState: "disabled" | "pending" | "applied" | "fallback";
  guardrailCode: string | null;
  routablePhone: string | null;
};

export function policyForBusiness(business: {
  timezone?: string;
  followUpCooldownMinutes?: number;
  dailySuggestionCap?: number;
  followUpWorkHoursEnabled?: boolean;
  followUpWorkHoursStart?: number;
  followUpWorkHoursEnd?: number;
  followUpQuietHoursEnabled?: boolean;
  followUpQuietHoursStart?: number;
  followUpQuietHoursEnd?: number;
}): SuggestionPolicy & { timezone: string } {
  const defaults = foundationPolicy();
  return {
    timezone: business.timezone ?? "Africa/Lagos",
    cooldownMinutes: business.followUpCooldownMinutes ?? defaults.followUpCooldownMinutes,
    dailyCap: business.dailySuggestionCap ?? defaults.dailySuggestionCap,
    workHoursEnabled: business.followUpWorkHoursEnabled ?? true,
    workHoursStart: business.followUpWorkHoursStart ?? defaults.workHoursStart,
    workHoursEnd: business.followUpWorkHoursEnd ?? defaults.workHoursEnd,
    quietHoursEnabled: business.followUpQuietHoursEnabled ?? true,
    quietHoursStart: business.followUpQuietHoursStart ?? defaults.quietHoursStart,
    quietHoursEnd: business.followUpQuietHoursEnd ?? defaults.quietHoursEnd,
  };
}

export async function cappedAvailableAt(ctx: MutationCtx, businessId: Id<"businesses">, requestedAt: number, policy: SuggestionPolicy & { timezone: string }): Promise<number> {
  let availableAt = nextAllowedSuggestionAt(requestedAt, policy.timezone, policy);
  // A capped day is deferred rather than discarded so the seller sees a stable,
  // auditable queue without exceeding the configured attention budget.
  for (let day = 0; day < 8; day += 1) {
    const bounds = localDayBounds(availableAt, policy.timezone);
    const tasks = await ctx.db.query("followUpTasks").withIndex("by_business_available", (builder) => builder.eq("businessId", businessId).gte("availableAt", bounds.start).lt("availableAt", bounds.end)).take(policy.dailyCap);
    if (tasks.length < policy.dailyCap) return availableAt;
    availableAt = nextAllowedSuggestionAt(bounds.end, policy.timezone, policy);
  }
  throw new Error("SUGGESTION_CAP_WINDOW_EXHAUSTED");
}

export async function createForMissedOpportunity(ctx: MutationCtx, opportunityId: Id<"missedRevenueOpportunities">): Promise<Id<"followUpTasks"> | null> {
  const existing = await ctx.db.query("followUpTasks").withIndex("by_opportunity", (builder) => builder.eq("opportunityId", opportunityId)).unique();
  if (existing) return existing._id;
  const opportunity = await ctx.db.get(opportunityId);
  if (!opportunity || opportunity.state !== "missed") return null;
  const [business, customer, conversation, interaction] = await Promise.all([
    ctx.db.get(opportunity.businessId),
    ctx.db.get(opportunity.customerId),
    ctx.db.get(opportunity.conversationId),
    ctx.db.get(opportunity.interactionId),
  ]);
  if (!business || business.foundationVersion !== 1 || !customer || customer.deletedAt !== undefined || !conversation || !interaction) return null;
  if (customer.businessId !== business._id || conversation.businessId !== business._id || interaction.businessId !== business._id || interaction.role !== "customer") return null;
  // Any later customer or seller message makes this exact suggestion stale. The
  // newer message may create its own independently evidenced opportunity.
  if (conversation.revision !== (opportunity.conversationRevision ?? conversation.revision) || conversation.lastEventAt > opportunity.triggerAt) return null;
  const policy = policyForBusiness(business);
  const recent = await ctx.db.query("followUpTasks").withIndex("by_customer_reason", (builder) => builder.eq("customerId", customer._id).eq("reason", "buying_signal")).order("desc").take(20);
  if (recent.some((task) => task.opportunityId !== undefined && task.createdAt > opportunity.triggerAt - policy.cooldownMinutes * 60000)) return null;
  const availableAt = await cappedAvailableAt(ctx, business._id, Math.max(Date.now(), opportunity.dueAt), policy);
  const draft = renderSafeSuggestion(business.followUpTemplate, customer.name);
  const aiEnabled = business.followUpAiEnabled === true && process.env.PHASE3_AI_SUGGESTIONS_ENABLED === "true";
  const taskId = await ctx.db.insert("followUpTasks", {
    businessId: business._id,
    customerId: customer._id,
    reason: "buying_signal",
    dueAt: availableAt,
    status: "pending",
    createdAt: Date.now(),
    opportunityId: opportunity._id,
    conversationId: conversation._id,
    triggerInteractionId: interaction._id,
    triggerAt: opportunity.triggerAt,
    conversationRevision: conversation.revision,
    journeyStage: customer.funnelStage ?? "engaged",
    draftText: draft.text,
    draftSource: "template",
    draftVersion: SUGGESTION_VERSION,
    draftHash: await sha256(draft.text),
    aiState: aiEnabled ? "pending" : "disabled",
    ...(draft.validationCode ? { guardrailCode: draft.validationCode } : {}),
    availableAt,
    expiresAt: interaction.expiresAt,
    policySnapshot: policy,
  });
  if (aiEnabled) await ctx.scheduler.runAfter(0, internal.followUps.generateAiSuggestion, { taskId });
  return taskId;
}

export const createTask = internalMutation({
  args: { opportunityId: v.id("missedRevenueOpportunities") },
  returns: v.union(v.id("followUpTasks"), v.null()),
  handler: async (ctx, args) => createForMissedOpportunity(ctx, args.opportunityId),
});

export const queue = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({
    taskId: v.id("followUpTasks"), customerId: v.id("customers"), customerName: v.string(), identity: v.string(), triggerMessage: v.string(), triggerAt: v.number(), availableAt: v.number(), journeyStage, draftText: v.string(), draftSource: v.union(v.literal("template"), v.literal("ai")), aiState: v.union(v.literal("disabled"), v.literal("pending"), v.literal("applied"), v.literal("fallback")), guardrailCode: v.union(v.string(), v.null()), routablePhone: v.union(v.string(), v.null()),
  })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const tasks = await ctx.db.query("followUpTasks").withIndex("by_business_status_available", (builder) => builder.eq("businessId", args.businessId).eq("status", "pending")).take(100);
    const output: QueueRow[] = [];
    for (const task of tasks) {
      if (!task.opportunityId || !task.triggerInteractionId || !task.triggerAt || !task.availableAt || !task.draftText || !task.draftSource || !task.aiState) continue;
      const [customer, interaction] = await Promise.all([ctx.db.get(task.customerId), ctx.db.get(task.triggerInteractionId)]);
      if (!customer || customer.businessId !== args.businessId || customer.deletedAt !== undefined || !interaction || interaction.businessId !== args.businessId) continue;
      const routablePhone = /^(\d+)@s\.whatsapp\.net$/.exec(customer.phone)?.[1] ?? null;
      output.push({ taskId: task._id, customerId: customer._id, customerName: customer.name ?? "Unnamed customer", identity: customer.phone, triggerMessage: interaction.content, triggerAt: task.triggerAt, availableAt: task.availableAt, journeyStage: task.journeyStage ?? customer.funnelStage ?? "engaged", draftText: task.draftText, draftSource: task.draftSource, aiState: task.aiState, guardrailCode: task.guardrailCode ?? null, routablePhone });
    }
    return output;
  },
});

export const settings = query({
  args: { businessId: v.id("businesses") },
  returns: v.object({ template: v.string(), cooldownMinutes: v.number(), dailyCap: v.number(), workHoursEnabled: v.boolean(), workHoursStart: v.number(), workHoursEnd: v.number(), quietHoursEnabled: v.boolean(), quietHoursStart: v.number(), quietHoursEnd: v.number(), aiEnabled: v.boolean(), aiAvailable: v.boolean() }),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId);
    const policy = policyForBusiness(business);
    return { template: business.followUpTemplate ?? DEFAULT_FOLLOW_UP_TEMPLATE, cooldownMinutes: policy.cooldownMinutes, dailyCap: policy.dailyCap, workHoursEnabled: policy.workHoursEnabled, workHoursStart: policy.workHoursStart, workHoursEnd: policy.workHoursEnd, quietHoursEnabled: policy.quietHoursEnabled, quietHoursStart: policy.quietHoursStart, quietHoursEnd: policy.quietHoursEnd, aiEnabled: business.followUpAiEnabled ?? false, aiAvailable: process.env.PHASE3_AI_SUGGESTIONS_ENABLED === "true" };
  },
});

export const updateSettings = mutation({
  args: { businessId: v.id("businesses"), template: v.string(), cooldownMinutes: v.number(), dailyCap: v.number(), workHoursEnabled: v.boolean(), workHoursStart: v.number(), workHoursEnd: v.number(), quietHoursEnabled: v.boolean(), quietHoursStart: v.number(), quietHoursEnd: v.number(), aiEnabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const values = [args.workHoursStart, args.workHoursEnd, args.quietHoursStart, args.quietHoursEnd];
    if (!values.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1439)) throw new ConvexError({ code: "INVALID_HOURS" });
    if (!Number.isSafeInteger(args.cooldownMinutes) || args.cooldownMinutes < 15 || args.cooldownMinutes > 43200) throw new ConvexError({ code: "INVALID_COOLDOWN" });
    if (!Number.isSafeInteger(args.dailyCap) || args.dailyCap < 1 || args.dailyCap > 100) throw new ConvexError({ code: "INVALID_DAILY_CAP" });
    const rendered = renderSafeSuggestion(args.template, "Customer");
    if (rendered.fallback) throw new ConvexError({ code: "UNSAFE_TEMPLATE", reason: rendered.validationCode });
    if (args.aiEnabled && process.env.PHASE3_AI_SUGGESTIONS_ENABLED !== "true") throw new ConvexError({ code: "AI_NOT_AVAILABLE" });
    await ctx.db.patch(args.businessId, { followUpTemplate: args.template.trim(), followUpCooldownMinutes: args.cooldownMinutes, dailySuggestionCap: args.dailyCap, followUpWorkHoursEnabled: args.workHoursEnabled, followUpWorkHoursStart: args.workHoursStart, followUpWorkHoursEnd: args.workHoursEnd, followUpQuietHoursEnabled: args.quietHoursEnabled, followUpQuietHoursStart: args.quietHoursStart, followUpQuietHoursEnd: args.quietHoursEnd, followUpAiEnabled: args.aiEnabled });
    return null;
  },
});

async function closeTask(ctx: MutationCtx, businessId: Id<"businesses">, taskId: Id<"followUpTasks">, status: "done" | "skipped") {
  await requireBusiness(ctx, businessId);
  const task = await ctx.db.get(taskId);
  if (!task || task.businessId !== businessId || !task.opportunityId) throw new ConvexError({ code: "NOT_FOUND" });
  if (task.status === "pending") await ctx.db.patch(task._id, { status, completedAt: Date.now() });
}

export const markHandled = mutation({ args: { businessId: v.id("businesses"), taskId: v.id("followUpTasks") }, returns: v.null(), handler: async (ctx, args) => { await closeTask(ctx, args.businessId, args.taskId, "done"); return null; } });
export const skip = mutation({ args: { businessId: v.id("businesses"), taskId: v.id("followUpTasks") }, returns: v.null(), handler: async (ctx, args) => { await closeTask(ctx, args.businessId, args.taskId, "skipped"); return null; } });

export const aiContext = internalQuery({
  args: { taskId: v.id("followUpTasks") },
  returns: v.union(v.null(), v.object({ taskId: v.id("followUpTasks"), businessContext: v.string(), tone: v.string(), language: v.string() })),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.status !== "pending" || task.aiState !== "pending" || !task.opportunityId) return null;
    const business = await ctx.db.get(task.businessId);
    if (!business || business.followUpAiEnabled !== true || process.env.PHASE3_AI_SUGGESTIONS_ENABLED !== "true") return null;
    return { taskId: task._id, businessContext: business.aiBusinessContext?.slice(0, 300) ?? "small retail business", tone: business.aiTone ?? "friendly", language: business.aiLanguageStyle ?? "english" };
  },
});

export const applyAiSuggestion = internalMutation({
  args: { taskId: v.id("followUpTasks"), text: v.optional(v.string()), failureCode: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.status !== "pending" || task.aiState !== "pending") return null;
    const validation = args.text ? validateSuggestion(args.text) : { safe: false, code: args.failureCode ?? "AI_FAILED" };
    if (!args.text || !validation.safe) {
      await ctx.db.patch(task._id, { aiState: "fallback", guardrailCode: validation.code ?? args.failureCode ?? "AI_FAILED" });
      return null;
    }
    const text = args.text.trim();
    await ctx.db.patch(task._id, { draftText: text, draftSource: "ai", draftVersion: SUGGESTION_VERSION, draftHash: await sha256(text), aiState: "applied", guardrailCode: undefined });
    return null;
  },
});

export const generateAiSuggestion = internalAction({
  args: { taskId: v.id("followUpTasks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.followUps.aiContext, args);
    if (!context) return null;
    const key = process.env.GROQ_API_KEY?.trim();
    const model = process.env.GROQ_LLM_MODEL?.trim();
    if (!key || !model) {
      await ctx.runMutation(internal.followUps.applyAiSuggestion, { taskId: args.taskId, failureCode: "AI_NOT_CONFIGURED" });
      return null;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), foundationPolicy().aiSuggestionTimeoutMs);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, temperature: 0.2, max_tokens: 120, messages: [
          { role: "system", content: "Write one short WhatsApp follow-up. Never mention or invent price, stock, availability, discounts, links, account numbers, payment details, delivery promises, or facts not supplied. Do not use placeholders." },
          { role: "user", content: `Business context: ${context.businessContext}\nTone: ${context.tone}\nLanguage style: ${context.language}\nAsk whether the customer still needs help. Return only the message.` },
        ] }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("AI_PROVIDER_FAILED");
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      await ctx.runMutation(internal.followUps.applyAiSuggestion, { taskId: args.taskId, text: body.choices?.[0]?.message?.content?.trim() });
    } catch {
      await ctx.runMutation(internal.followUps.applyAiSuggestion, { taskId: args.taskId, failureCode: "AI_FAILED" });
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});
