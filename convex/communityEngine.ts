import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireBusiness } from "./lib/authorization";
import { BUSINESS_SYSTEM_PROMPT_MAX_LENGTH, BUSINESS_SYSTEM_PROMPT_MIN_LENGTH } from "./lib/launch";
import { recordMilestone } from "./productAnalytics";
import { canProcessInboxMessage } from "./lib/inboxAi";

const opportunityState = v.union(v.literal("open"), v.literal("in_progress"), v.literal("won"), v.literal("lost"), v.literal("dismissed"));
const handoffState = v.union(v.literal("not_needed"), v.literal("suggested"), v.literal("consented"), v.literal("declined"), v.literal("completed"));

function clean(value: string, maximum: number) {
  return value.replaceAll("\u0000", "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function categoryFor(label: string | undefined, content: string) {
  const lower = content.toLowerCase();
  if (/\b(complain|complaint|refund|angry|disappointed|bad service|not working|damaged|scam|issue|problem)\b/.test(lower)) return "complaint" as const;
  if (/\b(i will pay|i'll pay|i go pay|reserve it|keep it for me|send account|send payment|i'm coming|i am coming)\b/.test(lower)) return "commitment" as const;
  if (label === "buying_signal" || label === "payment_related") return "opportunity" as const;
  if (label === "inquiry" || /\?|\b(how|what|where|when|which|can you|do you|is it|are you)\b/.test(lower)) return "question" as const;
  return null;
}

function urgencyFor(category: "opportunity" | "question" | "complaint" | "commitment", content: string) {
  if (category === "complaint" || /\b(urgent|today|now|asap|immediately|ready to pay)\b/i.test(content)) return "high" as const;
  return category === "question" ? "low" as const : "normal" as const;
}

function topicFor(content: string) {
  const withoutGreetings = content.replace(/\b(hello|hi|good morning|good afternoon|good evening|please|abeg)\b/gi, " ");
  return clean(withoutGreetings, 90) || "General request";
}

function nextStep(category: "opportunity" | "question" | "complaint" | "commitment", isGroup: boolean) {
  if (category === "complaint") return isGroup ? "Acknowledge this publicly, then move the details to a private chat after they agree." : "Acknowledge the issue and confirm who will resolve it and when.";
  if (category === "commitment") return isGroup ? "Confirm the next step without posting private payment details in the group." : "Confirm the payment or order step and record the outcome.";
  if (category === "question") return isGroup ? "Answer briefly from your approved business knowledge. Move private details to chat only with consent." : "Give a clear answer from your approved business knowledge.";
  return isGroup ? "Reply briefly, qualify what they need, and ask before moving to a private chat." : "Reply while the interest is fresh and guide them to the next buying step.";
}

export const captureFromInteraction = internalMutation({
  args: { interactionId: v.id("interactions") },
  returns: v.union(v.id("communityOpportunities"), v.null()),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.role !== "customer" || !interaction.conversationId || interaction.manualReviewRequired) return null;
    const existing = await ctx.db.query("communityOpportunities").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).unique();
    if (existing) return existing._id;
    const [business, customer, conversation] = await Promise.all([
      ctx.db.get(interaction.businessId), ctx.db.get(interaction.customerId), ctx.db.get(interaction.conversationId),
    ]);
    if (!canProcessInboxMessage(business, interaction) || !customer || customer.deletedAt !== undefined || !conversation || conversation.businessId !== business._id) return null;
    const evidenceText = clean(interaction.transcript || interaction.content, 2_000);
    if (!evidenceText) return null;
    const isGroup = interaction.isGroup ?? customer.isGroup ?? false;
    let group: Doc<"managedGroups"> | null = null;
    if (isGroup) {
      group = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", business._id).eq("groupJid", customer.phone)).unique();
      if (!group?.isEnabled) return null;
    }
    const category = categoryFor(interaction.classifierLabel, evidenceText);
    if (!category) return null;
    const now = Date.now();
    const privateHandoffState = isGroup && group?.allowPrivateHandoff && interaction.participantJid ? "suggested" as const : "not_needed" as const;
    const opportunityId = await ctx.db.insert("communityOpportunities", {
      businessId: business._id,
      customerId: customer._id,
      conversationId: conversation._id,
      interactionId: interaction._id,
      sourceType: isGroup ? "group" : "direct",
      ...(isGroup ? { sourceGroupJid: customer.phone, sourceGroupName: group?.groupName ?? customer.name ?? "WhatsApp group" } : {}),
      ...(interaction.participantJid ? { participantJid: interaction.participantJid } : {}),
      ...(interaction.participantName ? { participantName: interaction.participantName } : {}),
      category,
      state: "open",
      urgency: urgencyFor(category, evidenceText),
      confidence: interaction.classifierConfidence ?? (category === "complaint" || category === "commitment" ? 0.82 : 0.7),
      evidenceText,
      reason: category === "complaint" ? "A customer reported a problem that needs ownership." : category === "commitment" ? "A customer indicated they are ready for a next step." : category === "question" ? "A customer asked a business question that may affect a sale." : "The message shows buying or payment intent.",
      suggestedNextStep: nextStep(category, isGroup),
      demandTopic: topicFor(evidenceText),
      privateHandoffState,
      createdAt: now,
      updatedAt: now,
    });
    await recordMilestone(ctx, business._id, "firstUsefulOpportunityAt", now);
    if (category === "question") {
      const prior = await ctx.db.query("knowledgeSuggestions").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).unique();
      if (!prior) await ctx.db.insert("knowledgeSuggestions", {
        businessId: business._id,
        interactionId: interaction._id,
        opportunityId,
        question: evidenceText,
        suggestedFact: "Add a verified answer for this recurring customer question.",
        evidenceText,
        state: "pending",
        createdAt: now,
      });
    }
    return opportunityId;
  },
});

export const list = query({
  args: { businessId: v.id("businesses"), includeClosed: v.optional(v.boolean()) },
  returns: v.array(v.object({
    opportunityId: v.id("communityOpportunities"), interactionId: v.id("interactions"), customerId: v.id("customers"), customerName: v.string(), identity: v.string(), sourceType: v.union(v.literal("group"), v.literal("direct")), sourceName: v.string(), participantName: v.union(v.string(), v.null()), category: v.union(v.literal("opportunity"), v.literal("question"), v.literal("complaint"), v.literal("commitment")), state: opportunityState, urgency: v.union(v.literal("low"), v.literal("normal"), v.literal("high")), confidence: v.number(), evidenceText: v.string(), reason: v.string(), suggestedNextStep: v.string(), demandTopic: v.string(), privateHandoffState: handoffState, participantJid: v.union(v.string(), v.null()), consentInteractionId: v.union(v.id("interactions"), v.null()), dueAt: v.union(v.number(), v.null()), outcomeValue: v.number(), createdAt: v.number(), isTranscript: v.boolean(),
  })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const states = args.includeClosed ? ["open", "in_progress", "won", "lost", "dismissed"] as const : ["open", "in_progress"] as const;
    const records = (await Promise.all(states.map((state) => ctx.db.query("communityOpportunities").withIndex("by_business_state_updated", (builder) => builder.eq("businessId", args.businessId).eq("state", state)).order("desc").take(100)))).flat();
    const output: Array<{ opportunityId: Id<"communityOpportunities">; interactionId: Id<"interactions">; customerId: Id<"customers">; customerName: string; identity: string; sourceType: "group" | "direct"; sourceName: string; participantName: string | null; category: "opportunity" | "question" | "complaint" | "commitment"; state: "open" | "in_progress" | "won" | "lost" | "dismissed"; urgency: "low" | "normal" | "high"; confidence: number; evidenceText: string; reason: string; suggestedNextStep: string; demandTopic: string; privateHandoffState: "not_needed" | "suggested" | "consented" | "declined" | "completed"; participantJid: string | null; consentInteractionId: Id<"interactions"> | null; dueAt: number | null; outcomeValue: number; createdAt: number; isTranscript: boolean }> = [];
    for (const record of records) {
      const [customer, interaction] = await Promise.all([ctx.db.get(record.customerId), ctx.db.get(record.interactionId)]);
      if (!customer || customer.businessId !== args.businessId || customer.deletedAt !== undefined || !interaction || interaction.businessId !== args.businessId) continue;
      output.push({
        opportunityId: record._id, interactionId: interaction._id, customerId: customer._id,
        customerName: customer.name ?? "Unnamed customer", identity: customer.phone, sourceType: record.sourceType,
        sourceName: record.sourceType === "group" ? record.sourceGroupName ?? customer.name ?? "WhatsApp group" : customer.name ?? customer.phone.split("@")[0],
        participantName: record.participantName ?? null, category: record.category, state: record.state, urgency: record.urgency,
        confidence: record.confidence, evidenceText: record.evidenceText, reason: record.reason, suggestedNextStep: record.suggestedNextStep,
        demandTopic: record.demandTopic ?? "General request", privateHandoffState: record.privateHandoffState ?? "not_needed",
        participantJid: record.participantJid ?? null, consentInteractionId: record.privateHandoffConsentInteractionId ?? null, dueAt: record.dueAt ?? null, outcomeValue: record.outcomeValue ?? 0,
        createdAt: record.createdAt, isTranscript: interaction.transcriptionState === "completed",
      });
    }
    const urgencyRank = { high: 3, normal: 2, low: 1 } as const;
    return output.sort((left, right) => urgencyRank[right.urgency] - urgencyRank[left.urgency] || right.createdAt - left.createdAt).slice(0, 100);
  },
});

export const update = mutation({
  args: { businessId: v.id("businesses"), opportunityId: v.id("communityOpportunities"), state: v.optional(opportunityState), dueAt: v.optional(v.union(v.number(), v.null())), assignedTo: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity || opportunity.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    const state = args.state ?? opportunity.state;
    await ctx.db.patch(opportunity._id, {
      state, updatedAt: Date.now(),
      ...(args.dueAt !== undefined ? { dueAt: args.dueAt ?? undefined } : {}),
      ...(args.assignedTo !== undefined ? { assignedTo: clean(args.assignedTo ?? "", 100) || undefined } : {}),
      ...(["won", "lost", "dismissed"].includes(state) ? { closedAt: Date.now() } : {}),
    });
    return null;
  },
});

export const recordOutcome = mutation({
  args: { businessId: v.id("businesses"), opportunityId: v.id("communityOpportunities"), outcome: v.union(v.literal("won"), v.literal("lost")), value: v.optional(v.number()) },
  returns: v.union(v.id("orders"), v.null()),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity || opportunity.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    if (args.value !== undefined && (!Number.isSafeInteger(args.value) || args.value < 0 || args.value > 1_000_000_000)) throw new ConvexError({ code: "INVALID_ORDER_VALUE" });
    const existingOrder = await ctx.db.query("orders").withIndex("by_source_opportunity", (builder) => builder.eq("sourceOpportunityId", opportunity._id)).unique();
    const now = Date.now();
    let orderId: Id<"orders"> | null = existingOrder?._id ?? null;
    if (args.outcome === "won" && !existingOrder) {
      const value = args.value ?? 0;
      orderId = await ctx.db.insert("orders", { businessId: args.businessId, customerId: opportunity.customerId, items: [], totalAmount: value, status: "paid", createdAt: now, updatedAt: now, paidAt: now, sourceOpportunityId: opportunity._id, ...(opportunity.sourceGroupJid ? { sourceGroupJid: opportunity.sourceGroupJid } : {}) });
    }
    await ctx.db.patch(opportunity._id, { state: args.outcome, outcomeValue: args.outcome === "won" ? args.value ?? existingOrder?.totalAmount ?? 0 : 0, ...(orderId ? { orderId } : {}), updatedAt: now, closedAt: now });
    return orderId;
  },
});

export const setPrivateHandoff = mutation({
  args: { businessId: v.id("businesses"), opportunityId: v.id("communityOpportunities"), state: v.union(v.literal("consented"), v.literal("declined"), v.literal("completed")), consentInteractionId: v.optional(v.id("interactions")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity || opportunity.businessId !== args.businessId || opportunity.sourceType !== "group" || !opportunity.participantJid || opportunity.privateHandoffState === "not_needed") throw new ConvexError({ code: "HANDOFF_NOT_AVAILABLE" });
    if (args.state === "consented") {
      if (!args.consentInteractionId) throw new ConvexError({ code: "HANDOFF_CONSENT_EVIDENCE_REQUIRED" });
      const consent = await ctx.db.get(args.consentInteractionId);
      if (!consent || consent.businessId !== args.businessId || consent.conversationId !== opportunity.conversationId || consent.role !== "customer" || consent.timestamp < opportunity.createdAt || !/\b(yes|okay|ok|sure|dm me|message me|you can|go ahead|private chat)\b/i.test(consent.content)) throw new ConvexError({ code: "HANDOFF_CONSENT_EVIDENCE_REQUIRED" });
      await ctx.db.patch(opportunity._id, { privateHandoffState: "consented", privateHandoffConsentAt: consent.timestamp, privateHandoffConsentInteractionId: consent._id, updatedAt: Date.now() });
      await ctx.db.insert("handoffEvents", { businessId: args.businessId, opportunityId: opportunity._id, interactionId: consent._id, state: "consented", evidenceText: consent.content.slice(0, 1_000), recordedAt: Date.now() });
      return null;
    }
    if (args.state === "completed" && (!opportunity.privateHandoffConsentInteractionId || opportunity.privateHandoffState !== "consented")) throw new ConvexError({ code: "HANDOFF_CONSENT_REQUIRED" });
    const evidence = await ctx.db.get(opportunity.privateHandoffConsentInteractionId ?? opportunity.interactionId);
    await ctx.db.patch(opportunity._id, { privateHandoffState: args.state, updatedAt: Date.now() });
    await ctx.db.insert("handoffEvents", { businessId: args.businessId, opportunityId: opportunity._id, interactionId: evidence?._id ?? opportunity.interactionId, state: args.state, evidenceText: evidence?.content.slice(0, 1_000) ?? opportunity.evidenceText.slice(0, 1_000), recordedAt: Date.now() });
    return null;
  },
});

export const handoffConsentCandidates = query({
  args: { businessId: v.id("businesses"), opportunityId: v.id("communityOpportunities") },
  returns: v.array(v.object({ interactionId: v.id("interactions"), text: v.string(), timestamp: v.number() })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity || opportunity.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    if (opportunity.sourceType !== "group") return [];
    const messages = await ctx.db.query("interactions").withIndex("by_conversation", (builder) => builder.eq("conversationId", opportunity.conversationId).gte("timestamp", opportunity.createdAt)).order("desc").take(50);
    return messages.filter((message) => message.role === "customer" && /\b(yes|okay|ok|sure|dm me|message me|you can|go ahead|private chat)\b/i.test(message.content)).map((message) => ({ interactionId: message._id, text: message.content.slice(0, 300), timestamp: message.timestamp }));
  },
});

export const knowledge = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ suggestionId: v.id("knowledgeSuggestions"), question: v.string(), evidenceText: v.string(), createdAt: v.number() })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const rows = await ctx.db.query("knowledgeSuggestions").withIndex("by_business_state_created", (builder) => builder.eq("businessId", args.businessId).eq("state", "pending")).order("desc").take(50);
    return rows.map((row) => ({ suggestionId: row._id, question: row.question, evidenceText: row.evidenceText, createdAt: row.createdAt }));
  },
});

export const reviewKnowledge = mutation({
  args: { businessId: v.id("businesses"), suggestionId: v.id("knowledgeSuggestions"), decision: v.union(v.literal("approved"), v.literal("rejected")), answer: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId);
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion || suggestion.businessId !== args.businessId || suggestion.state !== "pending") throw new ConvexError({ code: "NOT_FOUND" });
    if (args.decision === "approved") {
      const answer = clean(args.answer ?? "", 1_500);
      if (answer.length < 10) throw new ConvexError({ code: "VERIFIED_ANSWER_REQUIRED" });
      const current = business.businessSystemPrompt?.trim() ?? "";
      if (current.length < BUSINESS_SYSTEM_PROMPT_MIN_LENGTH) throw new ConvexError({ code: "BUSINESS_PROMPT_REQUIRED" });
      const addition = `\n\nVerified business knowledge\nQuestion: ${clean(suggestion.question, 500)}\nAnswer: ${answer}`;
      if (current.length + addition.length > BUSINESS_SYSTEM_PROMPT_MAX_LENGTH) throw new ConvexError({ code: "BUSINESS_PROMPT_TOO_LONG" });
      await ctx.db.patch(business._id, { businessSystemPrompt: `${current}${addition}`, businessSystemPromptUpdatedAt: Date.now() });
    }
    await ctx.db.patch(suggestion._id, { state: args.decision, ...(args.answer ? { suggestedFact: clean(args.answer, 1_500) } : {}), reviewedAt: Date.now() });
    return null;
  },
});

export const insights = query({
  args: { businessId: v.id("businesses") },
  returns: v.object({ open: v.number(), won: v.number(), lost: v.number(), recordedRevenue: v.number(), groupRevenue: v.number(), directRevenue: v.number(), topDemand: v.array(v.object({ topic: v.string(), count: v.number() })), topGroups: v.array(v.object({ groupName: v.string(), opportunities: v.number(), revenue: v.number() })), unansweredQuestions: v.number(), complaints: v.number() }),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const states = ["open", "in_progress", "won", "lost", "dismissed"] as const;
    const records = (await Promise.all(states.map((state) => ctx.db.query("communityOpportunities").withIndex("by_business_state_updated", (builder) => builder.eq("businessId", args.businessId).eq("state", state)).order("desc").take(500)))).flat();
    const demand = new Map<string, number>();
    const groups = new Map<string, { opportunities: number; revenue: number }>();
    for (const record of records) {
      const topic = record.demandTopic ?? "General request";
      demand.set(topic, (demand.get(topic) ?? 0) + 1);
      if (record.sourceType === "group") {
        const name = record.sourceGroupName ?? "WhatsApp group";
        const current = groups.get(name) ?? { opportunities: 0, revenue: 0 };
        groups.set(name, { opportunities: current.opportunities + 1, revenue: current.revenue + (record.state === "won" ? record.outcomeValue ?? 0 : 0) });
      }
    }
    const won = records.filter((record) => record.state === "won");
    return {
      open: records.filter((record) => record.state === "open" || record.state === "in_progress").length,
      won: won.length, lost: records.filter((record) => record.state === "lost").length,
      recordedRevenue: won.reduce((sum, record) => sum + (record.outcomeValue ?? 0), 0),
      groupRevenue: won.filter((record) => record.sourceType === "group").reduce((sum, record) => sum + (record.outcomeValue ?? 0), 0),
      directRevenue: won.filter((record) => record.sourceType === "direct").reduce((sum, record) => sum + (record.outcomeValue ?? 0), 0),
      topDemand: [...demand].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      topGroups: [...groups].map(([groupName, value]) => ({ groupName, ...value })).sort((a, b) => b.revenue - a.revenue || b.opportunities - a.opportunities).slice(0, 8),
      unansweredQuestions: records.filter((record) => record.category === "question" && (record.state === "open" || record.state === "in_progress")).length,
      complaints: records.filter((record) => record.category === "complaint" && (record.state === "open" || record.state === "in_progress")).length,
    };
  },
});
