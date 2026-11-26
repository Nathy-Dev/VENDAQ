import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireBusiness, requireIdentity } from "./lib/authorization";
import { BUSINESS_SYSTEM_PROMPT_MAX_LENGTH, BUSINESS_SYSTEM_PROMPT_MIN_LENGTH } from "./lib/launch";
import { businessSystemPromptMessages, cleanBusinessText, promptSourceMaximum, promptSourceMinimum } from "./lib/businessPrompt";
import { billingAccess } from "./lib/billingAccess";
import { recordBusinessActivity, recordMilestone } from "./productAnalytics";
import { aiAssistantPatch, canProcessInboxMessage, isAiAssistantEnabled } from "./lib/inboxAi";

const qualificationField = v.union(v.literal("need"), v.literal("budget"), v.literal("location"), v.literal("timeline"), v.literal("readiness"));
const businessAiUsageKind = v.union(v.literal("prompt_generation"), v.literal("voice_transcription"));
const businessAiWindowMs = 60 * 60 * 1_000;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanPrompt(value: string): string {
  return cleanBusinessText(value);
}

function validateSystemPrompt(value: string): string {
  const prompt = cleanPrompt(value);
  if (prompt.length < BUSINESS_SYSTEM_PROMPT_MIN_LENGTH || prompt.length > BUSINESS_SYSTEM_PROMPT_MAX_LENGTH) {
    throw new ConvexError({ code: "INVALID_BUSINESS_SYSTEM_PROMPT" });
  }
  return prompt;
}

export const get = query({
  args: { businessId: v.id("businesses") },
  returns: v.object({
    name: v.string(),
    systemPrompt: v.string(),
    aiEnabled: v.boolean(),
    customerAutoReplyEnabled: v.boolean(),
    groupAutoReplyEnabled: v.boolean(),
    updatedAt: v.union(v.number(), v.null()),
    generatedAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId);
    return {
      name: business.name,
      systemPrompt: business.businessSystemPrompt ?? "",
      aiEnabled: isAiAssistantEnabled(business),
      customerAutoReplyEnabled: business.customerAutoReplyEnabled ?? false,
      groupAutoReplyEnabled: business.groupAutoReplyEnabled ?? false,
      updatedAt: business.businessSystemPromptUpdatedAt ?? null,
      generatedAt: business.businessSystemPromptGeneratedAt ?? null,
    };
  },
});

export const setAssistantEnabled = mutation({
  args: { businessId: v.id("businesses"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const hasReplyScopes = business.customerAutoReplyEnabled === true || business.groupAutoReplyEnabled === true;
    if (args.enabled) {
      const access = await billingAccess(ctx, business);
      if (!access.canUsePaidFeatures || (hasReplyScopes && !access.automation)) throw new ConvexError({ code: "BILLING_UPGRADE_REQUIRED" });
    }
    const now = Date.now();
    await ctx.db.patch(business._id, {
      ...aiAssistantPatch(business, args.enabled, now),
      killSwitch: !args.enabled || !hasReplyScopes,
      ...(args.enabled && hasReplyScopes && !isAiAssistantEnabled(business) ? { assistantConsentAt: now } : {}),
    });
    if (args.enabled && hasReplyScopes) await recordMilestone(ctx, business._id, "automationOptInAt", now);
    await recordBusinessActivity(ctx, business._id, now);
    return null;
  },
});

export const save = mutation({
  args: {
    businessId: v.id("businesses"),
    systemPrompt: v.string(),
    customerAutoReplyEnabled: v.boolean(),
    groupAutoReplyEnabled: v.boolean(),
    assistantSettingsVersion: v.optional(v.literal(2)),
    leadQualificationEnabled: v.optional(v.boolean()),
    leadQualificationCriteria: v.optional(v.string()),
    leadQualificationRequiredFields: v.optional(v.array(qualificationField)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Business knowledge is part of onboarding and remains editable when a
    // subscription is read-only. Paid reply authorization is still enforced
    // immediately below and again at every assistant dispatch boundary.
    const business = await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const access = await billingAccess(ctx, business);
    const hasReplyScopes = args.customerAutoReplyEnabled || args.groupAutoReplyEnabled;
    const legacyPause = args.assistantSettingsVersion === undefined && !hasReplyScopes;
    const enabled = !legacyPause && isAiAssistantEnabled(business);
    const addingReplyScope = (args.customerAutoReplyEnabled && !business.customerAutoReplyEnabled) || (args.groupAutoReplyEnabled && !business.groupAutoReplyEnabled);
    if (addingReplyScope && (!access.canUsePaidFeatures || !access.automation)) throw new ConvexError({ code: "BILLING_UPGRADE_REQUIRED" });
    const systemPrompt = validateSystemPrompt(args.systemPrompt);
    const now = Date.now();
    await ctx.db.patch(args.businessId, {
      ...(legacyPause ? aiAssistantPatch(business, false, now) : {}),
      businessSystemPrompt: systemPrompt,
      businessSystemPromptUpdatedAt: now,
      customerAutoReplyEnabled: args.customerAutoReplyEnabled,
      groupAutoReplyEnabled: args.groupAutoReplyEnabled,
      ...(args.leadQualificationEnabled !== undefined ? { leadQualificationEnabled: args.leadQualificationEnabled } : {}),
      ...(args.leadQualificationCriteria?.trim() ? { leadQualificationCriteria: args.leadQualificationCriteria.replaceAll("\u0000", "").trim().slice(0, 2_000) } : {}),
      ...(args.leadQualificationRequiredFields?.length ? { leadQualificationRequiredFields: [...new Set(args.leadQualificationRequiredFields)] } : {}),
      assistantConsentAt: hasReplyScopes ? (enabled ? now : business.assistantConsentAt) : undefined,
      killSwitch: !enabled || !hasReplyScopes,
      onboardingStep: 3,
    });
    if (enabled && hasReplyScopes) await recordMilestone(ctx, args.businessId, "automationOptInAt", now);
    await recordBusinessActivity(ctx, args.businessId, now);
    return null;
  },
});

export const canProcessMessage = internalQuery({
  args: { interactionId: v.id("interactions") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    return !!interaction && canProcessInboxMessage(await ctx.db.get(interaction.businessId), interaction);
  },
});

export const authorizeForGeneration = internalQuery({
  args: { businessId: v.id("businesses"), ownerId: v.string() },
  returns: v.union(v.object({ name: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business || business.ownerId !== args.ownerId || business.foundationVersion !== 1) {
      return null;
    }
    return { name: business.name };
  },
});

export const consumeBusinessAiUsage = internalMutation({
  args: { businessId: v.id("businesses"), kind: businessAiUsageKind },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const limit = args.kind === "prompt_generation"
      ? positiveInteger(process.env.BUSINESS_AI_PROMPT_GENERATIONS_PER_HOUR, 20)
      : positiveInteger(process.env.BUSINESS_AI_TRANSCRIPTIONS_PER_HOUR, 60);
    const existing = await ctx.db.query("businessAiUsage").withIndex("by_business_kind", (builder) => builder.eq("businessId", args.businessId).eq("kind", args.kind)).unique();
    const now = Date.now();
    const active = existing && existing.windowStart + businessAiWindowMs > now;
    const count = active ? existing.count + 1 : 1;
    if (existing) await ctx.db.patch(existing._id, { count: Math.min(count, limit + 1), windowStart: active ? existing.windowStart : now });
    else await ctx.db.insert("businessAiUsage", { businessId: args.businessId, kind: args.kind, count, windowStart: now });
    return count <= limit;
  },
});

export const generateSystemPrompt = action({
  args: { businessId: v.id("businesses"), businessDescription: v.string() },
  returns: v.object({ systemPrompt: v.string() }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const business = await ctx.runQuery(internal.businessProfile.authorizeForGeneration, {
      businessId: args.businessId,
      ownerId: identity.subject,
    });
    if (!business) throw new ConvexError({ code: "NOT_FOUND" });
    const description = cleanPrompt(args.businessDescription);
    if (description.length < promptSourceMinimum || description.length > promptSourceMaximum) {
      throw new ConvexError({ code: "INVALID_BUSINESS_DESCRIPTION" });
    }
    const apiKey = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_LLM_MODEL?.trim();
    if (!apiKey || !model) throw new ConvexError({ code: "AI_PROVIDER_NOT_CONFIGURED" });
    if (!(await ctx.runMutation(internal.businessProfile.consumeBusinessAiUsage, { businessId: args.businessId, kind: "prompt_generation" }))) {
      throw new ConvexError({ code: "BUSINESS_AI_RATE_LIMITED" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 1_600,
          messages: businessSystemPromptMessages(business.name, description),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new ConvexError({ code: "AI_GENERATION_FAILED" });
      const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const systemPrompt = validateSystemPrompt(result.choices?.[0]?.message?.content ?? "");
      return { systemPrompt };
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw new ConvexError({ code: "AI_GENERATION_FAILED" });
    } finally {
      clearTimeout(timeout);
    }
  },
});
