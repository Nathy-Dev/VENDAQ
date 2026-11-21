import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireBusiness } from "./lib/authorization";
import { detectCommitment, detectException, detectMemoryCandidates } from "./lib/commerceIntelligence";

const knowledgeKind = v.union(v.literal("business_fact"), v.literal("product"), v.literal("price"), v.literal("inventory"), v.literal("delivery"), v.literal("payment"), v.literal("returns"), v.literal("warranty"), v.literal("policy"), v.literal("faq"));
const exceptionState = v.union(v.literal("open"), v.literal("waiting_on_business"), v.literal("waiting_on_customer"), v.literal("resolved"), v.literal("dismissed"));
const conversationOutcome = v.union(v.literal("paid"), v.literal("booked"), v.literal("qualified"), v.literal("abandoned"), v.literal("lost_price"), v.literal("lost_stock"), v.literal("lost_delivery"), v.literal("resolved_support"), v.literal("unresolved_support"));

function clean(value: string, maximum: number): string {
  return value.replaceAll("\u0000", "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function paymentEvidence(content: string): boolean {
  return /\b(payment|transfer|transaction|bank|receipt|proof of payment|debit)\b/i.test(content)
    && /\b(receipt|screenshot|proof|successful|paid|transfer|transaction)\b/i.test(content);
}

function paymentAmount(content: string): number | undefined {
  const match = /(?:₦|ngn|n)\s*([\d,.]{3,})/i.exec(content);
  if (!match) return undefined;
  const amount = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000 ? amount : undefined;
}

function paymentReference(content: string): string | undefined {
  const match = /\b(?:reference|ref|transaction id|session id)\s*[:#-]?\s*([a-z0-9-]{5,40})\b/i.exec(content);
  return match ? clean(match[1], 40) : undefined;
}

export const captureFromInteraction = internalMutation({
  args: { interactionId: v.id("interactions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || !interaction.conversationId || !["customer", "owner"].includes(interaction.role) || interaction.manualReviewRequired) return null;
    const [business, customer] = await Promise.all([ctx.db.get(interaction.businessId), ctx.db.get(interaction.customerId)]);
    if (!business || business.foundationVersion !== 1 || !customer || customer.deletedAt !== undefined || customer.isGroup) return null;
    const now = Date.now();
    const commitment = detectCommitment(interaction.content, interaction.role === "owner" ? "owner" : "customer", interaction.timestamp);
    if (commitment) {
      const existing = await ctx.db.query("conversationCommitments").withIndex("by_source_interaction", (builder) => builder.eq("sourceInteractionId", interaction._id)).unique();
      if (!existing) await ctx.db.insert("conversationCommitments", {
        businessId: business._id, customerId: customer._id, conversationId: interaction.conversationId,
        sourceInteractionId: interaction._id, actor: commitment.actor, kind: commitment.kind,
        summary: commitment.summary, ...(commitment.dueAt ? { dueAt: commitment.dueAt } : {}),
        state: "open", confidence: commitment.confidence, createdAt: now, updatedAt: now,
      });
    }
    if (interaction.role === "customer") {
      for (const memory of detectMemoryCandidates(interaction.content)) {
        const existing = await ctx.db.query("customerMemories").withIndex("by_customer_key", (builder) => builder.eq("customerId", customer._id).eq("key", memory.key)).unique();
        if (existing) await ctx.db.patch(existing._id, { value: memory.value, category: memory.category, sourceInteractionId: interaction._id, state: existing.state === "verified" ? "verified" : "observed", confidence: Math.max(existing.confidence, memory.confidence), lastObservedAt: interaction.timestamp, updatedAt: now });
        else await ctx.db.insert("customerMemories", { businessId: business._id, customerId: customer._id, key: memory.key, value: memory.value, category: memory.category, sourceInteractionId: interaction._id, state: "observed", confidence: memory.confidence, lastObservedAt: interaction.timestamp, createdAt: now, updatedAt: now });
      }
      const exception = detectException(interaction.content);
      if (exception) {
        const existing = await ctx.db.query("commerceExceptions").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).unique();
        if (!existing) {
          const exceptionId = await ctx.db.insert("commerceExceptions", {
            businessId: business._id, customerId: customer._id, conversationId: interaction.conversationId,
            interactionId: interaction._id, kind: exception.kind, severity: exception.severity,
            state: exception.ownerQuestion ? "waiting_on_business" : "open", summary: exception.summary,
            ...(exception.ownerQuestion ? { ownerQuestion: exception.ownerQuestion } : {}), createdAt: now, updatedAt: now,
          });
          if (exception.ownerQuestion) {
            await ctx.db.insert("ownerRescueRequests", {
              businessId: business._id, customerId: customer._id, conversationId: interaction.conversationId,
              interactionId: interaction._id, exceptionId, reason: exception.kind === "refund" ? "policy_approval" : exception.kind === "payment_failure" ? "payment_review" : exception.kind === "complaint" ? "complaint" : "high_risk",
              question: exception.ownerQuestion, customerHoldingReply: "I’m checking this properly for you now. I’ll update you as soon as it is confirmed.",
              contextSummary: `${customer.name ?? "Customer"}: ${clean(interaction.content, 500)}`, state: "open", createdAt: now, updatedAt: now, expiresAt: now + 86_400_000,
            });
          }
        }
      }
      if (interaction.messageType === "image" && interaction.imageAnalysis && paymentEvidence(interaction.content)) {
        const existingProof = await ctx.db.query("paymentProofs").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).unique();
        if (!existingProof) {
          const providerConfigured = Boolean(process.env.PAYMENT_VERIFICATION_URL?.trim() && process.env.PAYMENT_VERIFICATION_API_KEY?.trim());
          const amount = paymentAmount(interaction.content);
          const reference = paymentReference(interaction.content);
          const proofId = await ctx.db.insert("paymentProofs", {
            businessId: business._id,
            customerId: customer._id,
            conversationId: interaction.conversationId,
            interactionId: interaction._id,
            ...(interaction.mediaId ? { mediaId: interaction.mediaId } : {}),
            ...(amount !== undefined ? { extractedAmount: amount } : {}),
            ...(reference ? { extractedReference: reference } : {}),
            receiptState: "review_required",
            verificationState: providerConfigured ? "pending" : "unavailable",
            ...(providerConfigured ? { verificationProvider: process.env.PAYMENT_VERIFICATION_PROVIDER?.trim() || "configured-provider" } : {}),
            verificationReason: providerConfigured ? "Waiting for independent payment verification." : "No independent payment verification provider is configured. Review this receipt manually.",
            createdAt: now,
            updatedAt: now,
          });
          const rescue = await ctx.db.query("ownerRescueRequests").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).first();
          if (!rescue) {
            await ctx.db.insert("ownerRescueRequests", {
              businessId: business._id,
              customerId: customer._id,
              conversationId: interaction.conversationId,
              interactionId: interaction._id,
              reason: "payment_review",
              question: "Can you confirm whether this payment has reached the business account?",
              customerHoldingReply: "Thanks, I have received the payment receipt. I am checking it properly now and will confirm once the payment is verified.",
              contextSummary: `${customer.name ?? "Customer"} sent payment evidence that has not been independently verified.`,
              state: "open",
              createdAt: now,
              updatedAt: now,
              expiresAt: now + 86_400_000,
            });
          }
          if (providerConfigured) await ctx.scheduler.runAfter(0, internal.commerceIntelligence.verifyPaymentProof, { proofId });
        }
      }
    }
    return null;
  },
});

export const paymentProofForVerification = internalQuery({
  args: { proofId: v.id("paymentProofs") },
  returns: v.union(v.null(), v.object({
    proofId: v.id("paymentProofs"),
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    orderId: v.union(v.id("orders"), v.null()),
    amount: v.union(v.number(), v.null()),
    reference: v.union(v.string(), v.null()),
  })),
  handler: async (ctx, args) => {
    const proof = await ctx.db.get(args.proofId);
    if (!proof || proof.verificationState !== "pending") return null;
    return { proofId: proof._id, businessId: proof.businessId, customerId: proof.customerId, orderId: proof.orderId ?? null, amount: proof.extractedAmount ?? null, reference: proof.extractedReference ?? null };
  },
});

export const finishPaymentVerification = internalMutation({
  args: {
    proofId: v.id("paymentProofs"),
    state: v.union(v.literal("verified"), v.literal("not_found"), v.literal("mismatch"), v.literal("unavailable")),
    provider: v.optional(v.string()),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const proof = await ctx.db.get(args.proofId);
    if (!proof || proof.verificationState !== "pending") return null;
    const now = Date.now();
    await ctx.db.patch(proof._id, {
      verificationState: args.state,
      receiptState: args.state === "verified" ? "matched" : "review_required",
      ...(args.provider ? { verificationProvider: clean(args.provider, 120) } : {}),
      verificationReason: clean(args.reason, 500),
      ...(args.state === "verified" ? { verifiedAt: now } : {}),
      updatedAt: now,
    });
    if (args.state === "verified") {
      const rescue = await ctx.db.query("ownerRescueRequests").withIndex("by_interaction", (builder) => builder.eq("interactionId", proof.interactionId)).first();
      if (rescue?.state === "open" && rescue.reason === "payment_review") await ctx.db.patch(rescue._id, { state: "answered", ownerAnswer: "Payment independently verified.", answeredAt: now, updatedAt: now });
    }
    return null;
  },
});

export const verifyPaymentProof = internalAction({
  args: { proofId: v.id("paymentProofs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const proof = await ctx.runQuery(internal.commerceIntelligence.paymentProofForVerification, args);
    if (!proof) return null;
    const url = process.env.PAYMENT_VERIFICATION_URL?.trim();
    const apiKey = process.env.PAYMENT_VERIFICATION_API_KEY?.trim();
    if (!url || !apiKey || !url.startsWith("https://")) {
      await ctx.runMutation(internal.commerceIntelligence.finishPaymentVerification, { proofId: proof.proofId, state: "unavailable", reason: "Independent verification is unavailable. Review the receipt manually." });
      return null;
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ businessId: proof.businessId, customerId: proof.customerId, orderId: proof.orderId, amount: proof.amount, reference: proof.reference }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`PAYMENT_PROVIDER_HTTP_${response.status}`);
      const result = await response.json() as { verified?: boolean; matched?: boolean; reason?: string; provider?: string };
      const state = result.verified === true && result.matched !== false ? "verified" : result.matched === false ? "mismatch" : "not_found";
      await ctx.runMutation(internal.commerceIntelligence.finishPaymentVerification, {
        proofId: proof.proofId,
        state,
        ...(result.provider ? { provider: result.provider } : {}),
        reason: result.reason || (state === "verified" ? "Payment independently verified." : state === "mismatch" ? "The transaction did not match the expected payment." : "No matching transaction was found."),
      });
    } catch {
      await ctx.runMutation(internal.commerceIntelligence.finishPaymentVerification, { proofId: proof.proofId, state: "unavailable", reason: "Independent verification could not be completed. Review the receipt manually." });
    }
    return null;
  },
});

export const gateForAssistant = internalQuery({
  args: { interactionId: v.id("interactions") },
  returns: v.union(v.null(), v.object({ holdingReply: v.string() })),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.role !== "customer" || interaction.isGroup) return null;
    const rescue = await ctx.db.query("ownerRescueRequests").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).first();
    if (rescue?.state === "open") return { holdingReply: rescue.customerHoldingReply };
    const proof = await ctx.db.query("paymentProofs").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).unique();
    if (proof && proof.verificationState !== "verified") return { holdingReply: "Thanks, I have received the payment receipt. I am checking it properly now and will confirm once the payment is verified." };
    return null;
  },
});

export const createGenerationRescue = internalMutation({
  args: {
    interactionId: v.id("interactions"),
    reason: v.union(v.literal("missing_fact"), v.literal("conflicting_fact"), v.literal("policy_approval"), v.literal("discount_approval"), v.literal("high_risk"), v.literal("other")),
    question: v.string(),
    holdingReply: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.role !== "customer" || !interaction.conversationId) return clean(args.holdingReply, 1_000);
    const existing = await ctx.db.query("ownerRescueRequests").withIndex("by_interaction", (builder) => builder.eq("interactionId", interaction._id)).first();
    if (existing?.state === "open") return existing.customerHoldingReply;
    const customer = await ctx.db.get(interaction.customerId);
    const now = Date.now();
    const holdingReply = clean(args.holdingReply, 1_000) || "I am checking that properly for you now. I will update you as soon as it is confirmed.";
    await ctx.db.insert("ownerRescueRequests", {
      businessId: interaction.businessId,
      customerId: interaction.customerId,
      conversationId: interaction.conversationId,
      interactionId: interaction._id,
      reason: args.reason,
      question: clean(args.question, 500) || "What should Pipelixr tell this customer?",
      customerHoldingReply: holdingReply,
      contextSummary: `${customer?.name ?? "Customer"}: ${clean(interaction.content, 700)}`,
      state: "open",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 86_400_000,
    });
    return holdingReply;
  },
});

export const assistantContext = internalQuery({
  args: { businessId: v.id("businesses"), customerId: v.id("customers"), conversationId: v.id("conversations"), now: v.number() },
  returns: v.object({
    knowledge: v.array(v.object({ title: v.string(), kind: knowledgeKind, content: v.string(), confidence: v.number(), verifiedAt: v.union(v.number(), v.null()) })),
    memories: v.array(v.object({ key: v.string(), value: v.string(), state: v.string(), confidence: v.number() })),
    commitments: v.array(v.object({ kind: v.string(), actor: v.string(), summary: v.string(), dueAt: v.union(v.number(), v.null()) })),
    exceptions: v.array(v.object({ kind: v.string(), severity: v.string(), summary: v.string(), state: v.string() })),
    negotiation: v.union(v.null(), v.object({ maximumDiscountPercent: v.number(), minimumPrice: v.union(v.number(), v.null()), freeDeliveryThreshold: v.union(v.number(), v.null()), requireApprovalBelow: v.union(v.number(), v.null()) })),
    payment: v.union(v.null(), v.object({ receiptState: v.string(), verificationState: v.string(), reason: v.union(v.string(), v.null()) })),
  }),
  handler: async (ctx, args) => {
    const [customer, conversation] = await Promise.all([ctx.db.get(args.customerId), ctx.db.get(args.conversationId)]);
    if (!customer || !conversation || customer.businessId !== args.businessId || conversation.businessId !== args.businessId || conversation.customerId !== customer._id) return { knowledge: [], memories: [], commitments: [], exceptions: [], negotiation: null, payment: null };
    const [knowledge, memories, commitments, openExceptions, waitingExceptions, policies, payments] = await Promise.all([
      ctx.db.query("businessKnowledge").withIndex("by_business_status_updated", (builder) => builder.eq("businessId", args.businessId).eq("status", "active")).order("desc").take(40),
      ctx.db.query("customerMemories").withIndex("by_customer_state_updated", (builder) => builder.eq("customerId", args.customerId).eq("state", "verified")).order("desc").take(20),
      ctx.db.query("conversationCommitments").withIndex("by_conversation_state", (builder) => builder.eq("conversationId", args.conversationId).eq("state", "open")).order("desc").take(20),
      ctx.db.query("commerceExceptions").withIndex("by_customer_state_updated", (builder) => builder.eq("customerId", args.customerId).eq("state", "open")).order("desc").take(10),
      ctx.db.query("commerceExceptions").withIndex("by_customer_state_updated", (builder) => builder.eq("customerId", args.customerId).eq("state", "waiting_on_business")).order("desc").take(10),
      ctx.db.query("negotiationPolicies").withIndex("by_business_active_scope", (builder) => builder.eq("businessId", args.businessId).eq("isActive", true).eq("scope", "all")).order("desc").take(1),
      ctx.db.query("paymentProofs").withIndex("by_customer_created", (builder) => builder.eq("customerId", args.customerId)).order("desc").take(1),
    ]);
    const policy = policies[0];
    const payment = payments[0];
    return {
      knowledge: knowledge.filter((entry) => entry.expiresAt === undefined || entry.expiresAt > args.now).map((entry) => ({ title: entry.title, kind: entry.kind, content: entry.content, confidence: entry.confidence, verifiedAt: entry.verifiedAt ?? null })),
      memories: memories.filter((memory) => memory.expiresAt === undefined || memory.expiresAt > args.now).map((memory) => ({ key: memory.key, value: memory.value, state: memory.state, confidence: memory.confidence })),
      commitments: commitments.map((entry) => ({ kind: entry.kind, actor: entry.actor, summary: entry.summary, dueAt: entry.dueAt ?? null })),
      exceptions: [...waitingExceptions, ...openExceptions].map((entry) => ({ kind: entry.kind, severity: entry.severity, summary: entry.summary, state: entry.state })),
      negotiation: policy ? { maximumDiscountPercent: policy.maximumDiscountPercent, minimumPrice: policy.minimumPrice ?? null, freeDeliveryThreshold: policy.freeDeliveryThreshold ?? null, requireApprovalBelow: policy.requireApprovalBelow ?? null } : null,
      payment: payment ? { receiptState: payment.receiptState, verificationState: payment.verificationState, reason: payment.verificationReason ?? null } : null,
    };
  },
});

export const dashboard = query({
  args: { businessId: v.id("businesses") },
  returns: v.object({ openCommitments: v.number(), overdueCommitments: v.number(), openExceptions: v.number(), urgentExceptions: v.number(), pendingPaymentProofs: v.number(), ownerQuestions: v.number(), verifiedMemories: v.number() }),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const [openCommitments, overdueCommitments, openExceptions, waitingExceptions, notStartedProofs, pendingProofs, unavailableProofs, notFoundProofs, mismatchProofs, ownerQuestions, verifiedMemories] = await Promise.all([
      ctx.db.query("conversationCommitments").withIndex("by_business_state_due", (builder) => builder.eq("businessId", args.businessId).eq("state", "open")).take(500),
      ctx.db.query("conversationCommitments").withIndex("by_business_state_due", (builder) => builder.eq("businessId", args.businessId).eq("state", "overdue")).take(500),
      ctx.db.query("commerceExceptions").withIndex("by_business_state_severity", (builder) => builder.eq("businessId", args.businessId).eq("state", "open")).take(500),
      ctx.db.query("commerceExceptions").withIndex("by_business_state_severity", (builder) => builder.eq("businessId", args.businessId).eq("state", "waiting_on_business")).take(500),
      ctx.db.query("paymentProofs").withIndex("by_business_verification_updated", (builder) => builder.eq("businessId", args.businessId).eq("verificationState", "not_started")).take(500),
      ctx.db.query("paymentProofs").withIndex("by_business_verification_updated", (builder) => builder.eq("businessId", args.businessId).eq("verificationState", "pending")).take(500),
      ctx.db.query("paymentProofs").withIndex("by_business_verification_updated", (builder) => builder.eq("businessId", args.businessId).eq("verificationState", "unavailable")).take(500),
      ctx.db.query("paymentProofs").withIndex("by_business_verification_updated", (builder) => builder.eq("businessId", args.businessId).eq("verificationState", "not_found")).take(500),
      ctx.db.query("paymentProofs").withIndex("by_business_verification_updated", (builder) => builder.eq("businessId", args.businessId).eq("verificationState", "mismatch")).take(500),
      ctx.db.query("ownerRescueRequests").withIndex("by_business_state_created", (builder) => builder.eq("businessId", args.businessId).eq("state", "open")).take(500),
      ctx.db.query("customerMemories").withIndex("by_business_state_updated", (builder) => builder.eq("businessId", args.businessId).eq("state", "verified")).take(500),
    ]);
    return { openCommitments: openCommitments.length, overdueCommitments: overdueCommitments.length, openExceptions: openExceptions.length + waitingExceptions.length, urgentExceptions: [...openExceptions, ...waitingExceptions].filter((entry) => entry.severity === "high" || entry.severity === "critical").length, pendingPaymentProofs: notStartedProofs.length + pendingProofs.length + unavailableProofs.length + notFoundProofs.length + mismatchProofs.length, ownerQuestions: ownerQuestions.length, verifiedMemories: verifiedMemories.length };
  },
});

export const workQueue = query({
  args: { businessId: v.id("businesses") },
  returns: v.object({
    commitments: v.array(v.object({ id: v.id("conversationCommitments"), customerId: v.id("customers"), customerName: v.string(), summary: v.string(), kind: v.string(), dueAt: v.union(v.number(), v.null()), state: v.string() })),
    exceptions: v.array(v.object({ id: v.id("commerceExceptions"), customerId: v.id("customers"), customerName: v.string(), summary: v.string(), kind: v.string(), severity: v.string(), state: v.string(), ownerQuestion: v.union(v.string(), v.null()) })),
    rescues: v.array(v.object({ id: v.id("ownerRescueRequests"), customerId: v.id("customers"), customerName: v.string(), question: v.string(), contextSummary: v.string(), createdAt: v.number() })),
    payments: v.array(v.object({ id: v.id("paymentProofs"), customerId: v.id("customers"), customerName: v.string(), receiptState: v.string(), verificationState: v.string(), amount: v.union(v.number(), v.null()), reason: v.union(v.string(), v.null()), createdAt: v.number() })),
  }),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const [openCommitments, overdueCommitments, openExceptions, waitingExceptions, rescues, notStartedProofs, pendingProofs, unavailableProofs, notFoundProofs, mismatchProofs] = await Promise.all([
      ctx.db.query("conversationCommitments").withIndex("by_business_state_due", (builder) => builder.eq("businessId", args.businessId).eq("state", "open")).order("asc").take(100),
      ctx.db.query("conversationCommitments").withIndex("by_business_state_due", (builder) => builder.eq("businessId", args.businessId).eq("state", "overdue")).order("asc").take(100),
      ctx.db.query("commerceExceptions").withIndex("by_business_state_severity", (builder) => builder.eq("businessId", args.businessId).eq("state", "open")).take(100),
      ctx.db.query("commerceExceptions").withIndex("by_business_state_severity", (builder) => builder.eq("businessId", args.businessId).eq("state", "waiting_on_business")).take(100),
      ctx.db.query("ownerRescueRequests").withIndex("by_business_state_created", (builder) => builder.eq("businessId", args.businessId).eq("state", "open")).order("desc").take(100),
      ctx.db.query("paymentProofs").withIndex("by_business_verification_updated", (builder) => builder.eq("businessId", args.businessId).eq("verificationState", "not_started")).order("desc").take(100),
      ctx.db.query("paymentProofs").withIndex("by_business_verification_updated", (builder) => builder.eq("businessId", args.businessId).eq("verificationState", "pending")).order("desc").take(100),
      ctx.db.query("paymentProofs").withIndex("by_business_verification_updated", (builder) => builder.eq("businessId", args.businessId).eq("verificationState", "unavailable")).order("desc").take(100),
      ctx.db.query("paymentProofs").withIndex("by_business_verification_updated", (builder) => builder.eq("businessId", args.businessId).eq("verificationState", "not_found")).order("desc").take(100),
      ctx.db.query("paymentProofs").withIndex("by_business_verification_updated", (builder) => builder.eq("businessId", args.businessId).eq("verificationState", "mismatch")).order("desc").take(100),
    ]);
    const customerIds = new Set([...openCommitments, ...overdueCommitments, ...openExceptions, ...waitingExceptions, ...rescues, ...notStartedProofs, ...pendingProofs, ...unavailableProofs, ...notFoundProofs, ...mismatchProofs].map((entry) => entry.customerId));
    const names = new Map<string, string>();
    for (const customerId of customerIds) { const customer = await ctx.db.get(customerId); names.set(customerId, customer?.name ?? "Customer"); }
    return {
      commitments: [...overdueCommitments, ...openCommitments].map((entry) => ({ id: entry._id, customerId: entry.customerId, customerName: names.get(entry.customerId) ?? "Customer", summary: entry.summary, kind: entry.kind, dueAt: entry.dueAt ?? null, state: entry.state })),
      exceptions: [...waitingExceptions, ...openExceptions].map((entry) => ({ id: entry._id, customerId: entry.customerId, customerName: names.get(entry.customerId) ?? "Customer", summary: entry.summary, kind: entry.kind, severity: entry.severity, state: entry.state, ownerQuestion: entry.ownerQuestion ?? null })),
      rescues: rescues.map((entry) => ({ id: entry._id, customerId: entry.customerId, customerName: names.get(entry.customerId) ?? "Customer", question: entry.question, contextSummary: entry.contextSummary, createdAt: entry.createdAt })),
      payments: [...mismatchProofs, ...notFoundProofs, ...unavailableProofs, ...pendingProofs, ...notStartedProofs].map((entry) => ({ id: entry._id, customerId: entry.customerId, customerName: names.get(entry.customerId) ?? "Customer", receiptState: entry.receiptState, verificationState: entry.verificationState, amount: entry.extractedAmount ?? null, reason: entry.verificationReason ?? null, createdAt: entry.createdAt })),
    };
  },
});

export const saveKnowledge = mutation({
  args: { businessId: v.id("businesses"), knowledgeId: v.optional(v.id("businessKnowledge")), title: v.string(), kind: knowledgeKind, content: v.string(), sourceType: v.optional(v.union(v.literal("owner"), v.literal("system_prompt"), v.literal("catalog"), v.literal("integration"), v.literal("conversation"))), expiresAt: v.optional(v.number()) },
  returns: v.id("businessKnowledge"),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId);
    const now = Date.now(); const title = clean(args.title, 120); const content = clean(args.content, 8_000);
    if (title.length < 2 || content.length < 3) throw new ConvexError({ code: "INVALID_KNOWLEDGE" });
    if (args.knowledgeId) { const row = await ctx.db.get(args.knowledgeId); if (!row || row.businessId !== business._id) throw new ConvexError({ code: "NOT_FOUND" }); await ctx.db.patch(row._id, { title, kind: args.kind, content, status: "active", confidence: 1, verifiedAt: now, verifiedBy: business.ownerId, updatedAt: now, ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}) }); return row._id; }
    return await ctx.db.insert("businessKnowledge", { businessId: business._id, title, kind: args.kind, content, sourceType: args.sourceType ?? "owner", status: "active", confidence: 1, effectiveAt: now, ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}), verifiedAt: now, verifiedBy: business.ownerId, createdAt: now, updatedAt: now });
  },
});

export const listKnowledge = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ id: v.id("businessKnowledge"), title: v.string(), kind: knowledgeKind, content: v.string(), status: v.string(), updatedAt: v.number(), verifiedAt: v.union(v.number(), v.null()) })),
  handler: async (ctx, args) => { await requireBusiness(ctx, args.businessId); const rows = await ctx.db.query("businessKnowledge").withIndex("by_business_status_updated", (builder) => builder.eq("businessId", args.businessId).eq("status", "active")).order("desc").take(200); return rows.map((row) => ({ id: row._id, title: row.title, kind: row.kind, content: row.content, status: row.status, updatedAt: row.updatedAt, verifiedAt: row.verifiedAt ?? null })); },
});

export const archiveKnowledge = mutation({
  args: { businessId: v.id("businesses"), knowledgeId: v.id("businessKnowledge") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const row = await ctx.db.get(args.knowledgeId);
    if (!row || row.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    await ctx.db.patch(row._id, { status: "archived", updatedAt: Date.now() });
    return null;
  },
});

export const conversationIntelligence = query({
  args: { businessId: v.id("businesses"), customerId: v.id("customers") },
  returns: v.object({
    conversationId: v.union(v.id("conversations"), v.null()),
    memories: v.array(v.object({ id: v.id("customerMemories"), key: v.string(), value: v.string(), state: v.string(), confidence: v.number() })),
    commitments: v.array(v.object({ id: v.id("conversationCommitments"), summary: v.string(), state: v.string(), dueAt: v.union(v.number(), v.null()) })),
    payments: v.array(v.object({ id: v.id("paymentProofs"), receiptState: v.string(), verificationState: v.string(), amount: v.union(v.number(), v.null()), reason: v.union(v.string(), v.null()), createdAt: v.number() })),
    latestOutcome: v.union(v.null(), v.object({ id: v.id("conversationOutcomes"), outcome: conversationOutcome, value: v.union(v.number(), v.null()), objection: v.union(v.string(), v.null()), sourceCampaignId: v.union(v.string(), v.null()), sourceAdId: v.union(v.string(), v.null()), occurredAt: v.number() })),
    qualification: v.union(v.null(), v.object({ status: v.string(), score: v.number(), answers: v.array(v.object({ field: v.string(), value: v.string() })), missingFields: v.array(v.string()), fitReason: v.union(v.string(), v.null()), updatedAt: v.number() })),
  }),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    const conversations = await ctx.db.query("conversations").withIndex("by_customer", (builder) => builder.eq("customerId", customer._id)).order("desc").take(20);
    const conversation = conversations.reduce<(typeof conversations)[number] | null>((latest, current) => !latest || current.lastEventAt > latest.lastEventAt ? current : latest, null);
    const [observed, verified, disputed, forgotten, openCommitments, overdueCommitments, payments, latestOutcome, qualification] = await Promise.all([
      ctx.db.query("customerMemories").withIndex("by_customer_state_updated", (builder) => builder.eq("customerId", customer._id).eq("state", "observed")).order("desc").take(50),
      ctx.db.query("customerMemories").withIndex("by_customer_state_updated", (builder) => builder.eq("customerId", customer._id).eq("state", "verified")).order("desc").take(50),
      ctx.db.query("customerMemories").withIndex("by_customer_state_updated", (builder) => builder.eq("customerId", customer._id).eq("state", "disputed")).order("desc").take(20),
      ctx.db.query("customerMemories").withIndex("by_customer_state_updated", (builder) => builder.eq("customerId", customer._id).eq("state", "forgotten")).order("desc").take(20),
      ctx.db.query("conversationCommitments").withIndex("by_customer_state_updated", (builder) => builder.eq("customerId", customer._id).eq("state", "open")).order("desc").take(50),
      ctx.db.query("conversationCommitments").withIndex("by_customer_state_updated", (builder) => builder.eq("customerId", customer._id).eq("state", "overdue")).order("desc").take(50),
      ctx.db.query("paymentProofs").withIndex("by_customer_created", (builder) => builder.eq("customerId", customer._id)).order("desc").take(20),
      conversation ? ctx.db.query("conversationOutcomes").withIndex("by_conversation_occurred", (builder) => builder.eq("conversationId", conversation._id)).order("desc").first() : null,
      conversation ? ctx.db.query("leadQualifications").withIndex("by_conversation", (builder) => builder.eq("conversationId", conversation._id)).unique() : null,
    ]);
    return {
      conversationId: conversation?._id ?? null,
      memories: [...verified, ...observed, ...disputed, ...forgotten].map((memory) => ({ id: memory._id, key: memory.key, value: memory.value, state: memory.state, confidence: memory.confidence })),
      commitments: [...overdueCommitments, ...openCommitments].map((item) => ({ id: item._id, summary: item.summary, state: item.state, dueAt: item.dueAt ?? null })),
      payments: payments.map((proof) => ({ id: proof._id, receiptState: proof.receiptState, verificationState: proof.verificationState, amount: proof.extractedAmount ?? null, reason: proof.verificationReason ?? null, createdAt: proof.createdAt })),
      latestOutcome: latestOutcome ? { id: latestOutcome._id, outcome: latestOutcome.outcome, value: latestOutcome.value ?? null, objection: latestOutcome.objection ?? null, sourceCampaignId: latestOutcome.sourceCampaignId ?? null, sourceAdId: latestOutcome.sourceAdId ?? null, occurredAt: latestOutcome.occurredAt } : null,
      qualification: qualification ? { status: qualification.status, score: qualification.score, answers: qualification.answers.map((answer) => ({ field: answer.field, value: answer.value })), missingFields: qualification.missingFields, fitReason: qualification.fitReason ?? null, updatedAt: qualification.updatedAt } : null,
    };
  },
});

export const verifyMemory = mutation({
  args: { businessId: v.id("businesses"), memoryId: v.id("customerMemories"), state: v.union(v.literal("verified"), v.literal("disputed"), v.literal("forgotten")) }, returns: v.null(),
  handler: async (ctx, args) => { await requireBusiness(ctx, args.businessId); const memory = await ctx.db.get(args.memoryId); if (!memory || memory.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" }); await ctx.db.patch(memory._id, { state: args.state, ...(args.state === "verified" ? { verifiedAt: Date.now() } : {}), updatedAt: Date.now() }); return null; },
});

export const completeCommitment = mutation({
  args: { businessId: v.id("businesses"), commitmentId: v.id("conversationCommitments"), state: v.union(v.literal("completed"), v.literal("cancelled")) }, returns: v.null(),
  handler: async (ctx, args) => { await requireBusiness(ctx, args.businessId); const item = await ctx.db.get(args.commitmentId); if (!item || item.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" }); await ctx.db.patch(item._id, { state: args.state, completedAt: Date.now(), updatedAt: Date.now() }); return null; },
});

export const resolveException = mutation({
  args: { businessId: v.id("businesses"), exceptionId: v.id("commerceExceptions"), state: exceptionState, approvedResolution: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => { await requireBusiness(ctx, args.businessId); const item = await ctx.db.get(args.exceptionId); if (!item || item.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" }); await ctx.db.patch(item._id, { state: args.state, ...(args.approvedResolution ? { approvedResolution: clean(args.approvedResolution, 1_000) } : {}), ...(args.state === "resolved" ? { resolvedAt: Date.now() } : {}), updatedAt: Date.now() }); return null; },
});

export const reviewPaymentProof = mutation({
  args: { businessId: v.id("businesses"), proofId: v.id("paymentProofs"), decision: v.union(v.literal("keep_for_review"), v.literal("reject")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const proof = await ctx.db.get(args.proofId);
    if (!proof || proof.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    if (proof.verificationState === "verified") throw new ConvexError({ code: "VERIFIED_PAYMENT_IMMUTABLE" });
    await ctx.db.patch(proof._id, {
      receiptState: args.decision === "reject" ? "rejected" : "review_required",
      verificationReason: args.decision === "reject" ? "The business rejected this receipt as payment evidence." : proof.verificationReason,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const answerRescue = mutation({
  args: { businessId: v.id("businesses"), rescueId: v.id("ownerRescueRequests"), answer: v.string() }, returns: v.null(),
  handler: async (ctx, args) => { await requireBusiness(ctx, args.businessId); const item = await ctx.db.get(args.rescueId); if (!item || item.businessId !== args.businessId || item.state !== "open") throw new ConvexError({ code: "NOT_FOUND" }); const answer = clean(args.answer, 1_000); if (answer.length < 2) throw new ConvexError({ code: "INVALID_ANSWER" }); const now = Date.now(); await ctx.db.patch(item._id, { state: "answered", ownerAnswer: answer, answeredAt: now, updatedAt: now }); if (item.exceptionId) { const exception = await ctx.db.get(item.exceptionId); if (exception) await ctx.db.patch(exception._id, { state: "open", approvedResolution: answer, updatedAt: now }); } return null; },
});

export const saveNegotiationPolicy = mutation({
  args: { businessId: v.id("businesses"), name: v.string(), maximumDiscountPercent: v.number(), minimumPrice: v.optional(v.number()), freeDeliveryThreshold: v.optional(v.number()), requireApprovalBelow: v.optional(v.number()), allowedBundles: v.array(v.string()) }, returns: v.id("negotiationPolicies"),
  handler: async (ctx, args) => { await requireBusiness(ctx, args.businessId); if (!Number.isFinite(args.maximumDiscountPercent) || args.maximumDiscountPercent < 0 || args.maximumDiscountPercent > 100) throw new ConvexError({ code: "INVALID_POLICY" }); const now = Date.now(); const current = await ctx.db.query("negotiationPolicies").withIndex("by_business_active_scope", (builder) => builder.eq("businessId", args.businessId).eq("isActive", true).eq("scope", "all")).take(10); for (const policy of current) await ctx.db.patch(policy._id, { isActive: false, updatedAt: now }); return await ctx.db.insert("negotiationPolicies", { businessId: args.businessId, name: clean(args.name, 120), scope: "all", minimumPrice: args.minimumPrice, maximumDiscountPercent: args.maximumDiscountPercent, freeDeliveryThreshold: args.freeDeliveryThreshold, allowedBundles: args.allowedBundles.map((value) => clean(value, 120)).filter(Boolean).slice(0, 20), requireApprovalBelow: args.requireApprovalBelow, isActive: true, createdAt: now, updatedAt: now }); },
});

export const negotiationPolicy = query({
  args: { businessId: v.id("businesses") },
  returns: v.union(v.null(), v.object({ id: v.id("negotiationPolicies"), name: v.string(), maximumDiscountPercent: v.number(), minimumPrice: v.union(v.number(), v.null()), freeDeliveryThreshold: v.union(v.number(), v.null()), requireApprovalBelow: v.union(v.number(), v.null()), allowedBundles: v.array(v.string()) })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const policy = await ctx.db.query("negotiationPolicies").withIndex("by_business_active_scope", (builder) => builder.eq("businessId", args.businessId).eq("isActive", true).eq("scope", "all")).order("desc").first();
    return policy ? { id: policy._id, name: policy.name, maximumDiscountPercent: policy.maximumDiscountPercent, minimumPrice: policy.minimumPrice ?? null, freeDeliveryThreshold: policy.freeDeliveryThreshold ?? null, requireApprovalBelow: policy.requireApprovalBelow ?? null, allowedBundles: policy.allowedBundles } : null;
  },
});

export const recordOutcome = mutation({
  args: { businessId: v.id("businesses"), customerId: v.id("customers"), conversationId: v.id("conversations"), outcome: conversationOutcome, value: v.optional(v.number()), objection: v.optional(v.string()), decisiveInteractionId: v.optional(v.id("interactions")), sourceCampaignId: v.optional(v.string()), sourceAdSetId: v.optional(v.string()), sourceAdId: v.optional(v.string()), sourceCreativeId: v.optional(v.string()) }, returns: v.id("conversationOutcomes"),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const [customer, conversation, decisiveInteraction] = await Promise.all([
      ctx.db.get(args.customerId),
      ctx.db.get(args.conversationId),
      args.decisiveInteractionId ? ctx.db.get(args.decisiveInteractionId) : null,
    ]);
    if (!customer || !conversation || customer.businessId !== args.businessId || conversation.businessId !== args.businessId || conversation.customerId !== customer._id) throw new ConvexError({ code: "NOT_FOUND" });
    if (decisiveInteraction && (decisiveInteraction.businessId !== args.businessId || decisiveInteraction.customerId !== customer._id || decisiveInteraction.conversationId !== conversation._id)) throw new ConvexError({ code: "INVALID_OUTCOME_EVIDENCE" });
    if (args.value !== undefined && (!Number.isFinite(args.value) || args.value < 0 || args.value > 1_000_000_000)) throw new ConvexError({ code: "INVALID_OUTCOME_VALUE" });
    const now = Date.now();
    const existing = await ctx.db.query("conversationOutcomes").withIndex("by_conversation_occurred", (builder) => builder.eq("conversationId", conversation._id)).order("desc").first();
    const update = {
      outcome: args.outcome,
      value: args.value,
      objection: args.objection?.trim() ? clean(args.objection, 500) : undefined,
      decisiveInteractionId: args.decisiveInteractionId,
      sourceCampaignId: args.sourceCampaignId?.trim() ? clean(args.sourceCampaignId, 160) : undefined,
      sourceAdSetId: args.sourceAdSetId?.trim() ? clean(args.sourceAdSetId, 160) : undefined,
      sourceAdId: args.sourceAdId?.trim() ? clean(args.sourceAdId, 160) : undefined,
      sourceCreativeId: args.sourceCreativeId?.trim() ? clean(args.sourceCreativeId, 160) : undefined,
      recordedBy: "owner" as const,
      occurredAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, update);
      return existing._id;
    }
    return await ctx.db.insert("conversationOutcomes", { businessId: args.businessId, customerId: customer._id, conversationId: conversation._id, ...update, createdAt: now });
  },
});

export const insights = query({
  args: { businessId: v.id("businesses"), since: v.optional(v.number()) },
  returns: v.object({ total: v.number(), paid: v.number(), booked: v.number(), qualified: v.number(), lost: v.number(), resolvedSupport: v.number(), unresolvedSupport: v.number(), recordedValue: v.number(), topObjections: v.array(v.object({ objection: v.string(), count: v.number() })), topAds: v.array(v.object({ adId: v.string(), conversations: v.number(), paid: v.number(), value: v.number() })) }),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const since = args.since ?? 0;
    const rows = await ctx.db.query("conversationOutcomes").withIndex("by_business_occurred", (builder) => builder.eq("businessId", args.businessId).gte("occurredAt", since)).order("desc").take(2_000);
    const currentByConversation = new Map<string, (typeof rows)[number]>();
    for (const row of rows) if (!currentByConversation.has(row.conversationId)) currentByConversation.set(row.conversationId, row);
    const currentRows = [...currentByConversation.values()];
    const objections = new Map<string, number>();
    const ads = new Map<string, { conversations: number; paid: number; value: number }>();
    for (const row of currentRows) {
      if (row.objection) objections.set(row.objection, (objections.get(row.objection) ?? 0) + 1);
      const source = row.sourceCampaignId ?? row.sourceAdId;
      if (source) {
        const current = ads.get(source) ?? { conversations: 0, paid: 0, value: 0 };
        current.conversations += 1;
        if (row.outcome === "paid") current.paid += 1;
        current.value += row.outcome === "paid" ? row.value ?? 0 : 0;
        ads.set(source, current);
      }
    }
    return {
      total: currentRows.length,
      paid: currentRows.filter((row) => row.outcome === "paid").length,
      booked: currentRows.filter((row) => row.outcome === "booked").length,
      qualified: currentRows.filter((row) => row.outcome === "qualified").length,
      lost: currentRows.filter((row) => row.outcome.startsWith("lost_") || row.outcome === "abandoned").length,
      resolvedSupport: currentRows.filter((row) => row.outcome === "resolved_support").length,
      unresolvedSupport: currentRows.filter((row) => row.outcome === "unresolved_support").length,
      recordedValue: currentRows.reduce((sum, row) => sum + (row.outcome === "paid" ? row.value ?? 0 : 0), 0),
      topObjections: [...objections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([objection, count]) => ({ objection, count })),
      topAds: [...ads.entries()].sort((a, b) => b[1].value - a[1].value || b[1].paid - a[1].paid).slice(0, 10).map(([adId, result]) => ({ adId, ...result })),
    };
  },
});
