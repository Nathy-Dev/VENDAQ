import { ConvexError, v } from "convex/values";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireBusiness, requireIdentity } from "./lib/authorization";
import {
  COMMUNICATION_POLICY_VERSION,
  LEGAL_VERSIONS,
  hasCurrentLegalAcceptance,
  requiredAccountDocuments,
  requiredBusinessDocuments,
  requiredCheckoutDocuments,
} from "./lib/compliance";
import { decryptSecret } from "./lib/crypto";
import { paystackRequest } from "./lib/paystack";
import type { Id } from "./_generated/dataModel";

const legalDocument = v.union(v.literal("terms"), v.literal("privacy"), v.literal("dpa"), v.literal("billing"), v.literal("acceptable_use"));
const requestType = v.union(v.literal("access"), v.literal("export"), v.literal("correction"), v.literal("restriction"), v.literal("objection"), v.literal("erasure"));

export const legalStatus = query({
  args: {},
  returns: v.object({
    ready: v.boolean(),
    versions: v.object({ terms: v.string(), privacy: v.string(), dpa: v.string(), billing: v.string(), acceptable_use: v.string() }),
    accepted: v.object({ terms: v.boolean(), privacy: v.boolean(), dpa: v.boolean(), billing: v.boolean(), acceptable_use: v.boolean() }),
  }),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const entries = await Promise.all((Object.keys(LEGAL_VERSIONS) as Array<keyof typeof LEGAL_VERSIONS>).map(async (document) => [document, await hasCurrentLegalAcceptance(ctx, identity.subject, document)] as const));
    const accepted = Object.fromEntries(entries) as Record<keyof typeof LEGAL_VERSIONS, boolean>;
    const ready = [...requiredAccountDocuments, ...requiredBusinessDocuments].every((document) => accepted[document]);
    return { ready, versions: LEGAL_VERSIONS, accepted };
  },
});

export const acceptLegal = mutation({
  args: { documents: v.array(legalDocument), method: v.union(v.literal("account_gate"), v.literal("checkout_gate")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const documents = [...new Set(args.documents)];
    if (documents.length === 0 || documents.length > 5) throw new ConvexError({ code: "INVALID_LEGAL_ACCEPTANCE" });
    const business = await ctx.db.query("businesses").withIndex("by_owner", (builder) => builder.eq("ownerId", identity.subject)).unique();
    const now = Date.now();
    for (const document of documents) {
      if (args.method === "checkout_gate" && !requiredCheckoutDocuments.includes(document)) throw new ConvexError({ code: "INVALID_LEGAL_ACCEPTANCE" });
      if (args.method === "account_gate" && ![...requiredAccountDocuments, ...requiredBusinessDocuments].includes(document)) throw new ConvexError({ code: "INVALID_LEGAL_ACCEPTANCE" });
      if (!await hasCurrentLegalAcceptance(ctx, identity.subject, document)) {
        await ctx.db.insert("legalAcceptances", { subject: identity.subject, businessId: business?._id, document, version: LEGAL_VERSIONS[document], acceptedAt: now, acceptanceMethod: args.method });
      }
    }
    await ctx.db.insert("complianceAudit", { businessId: business?._id, actor: identity.subject, action: "legal_documents_accepted", subjectType: "account", subjectRef: documents.join(","), at: now, metadata: args.method });
    return null;
  },
});

export const customerCommunication = query({
  args: { businessId: v.id("businesses"), customerId: v.id("customers") },
  returns: v.object({ state: v.union(v.literal("unknown"), v.literal("service_only"), v.literal("marketing_opted_in"), v.literal("opted_out")), serviceConsentAt: v.union(v.number(), v.null()), marketingConsentAt: v.union(v.number(), v.null()), optedOutAt: v.union(v.number(), v.null()), marketingEvidence: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    return { state: customer.communicationState ?? (customer.firstInboundAt ? "service_only" : "unknown"), serviceConsentAt: customer.serviceConsentAt ?? customer.firstInboundAt ?? null, marketingConsentAt: customer.marketingConsentAt ?? null, optedOutAt: customer.optedOutAt ?? null, marketingEvidence: customer.marketingConsentEvidence ?? null };
  },
});

export const recordCustomerCommunication = mutation({
  args: { businessId: v.id("businesses"), customerId: v.id("customers"), decision: v.union(v.literal("marketing_granted"), v.literal("marketing_withdrawn")), evidence: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId);
    const identity = await requireIdentity(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== business._id || !customer.identityKey || customer.isGroup) throw new ConvexError({ code: "NOT_FOUND" });
    const evidence = args.evidence?.trim();
    if (args.decision === "marketing_granted" && (!evidence || evidence.length < 10 || evidence.length > 500)) throw new ConvexError({ code: "CONSENT_EVIDENCE_REQUIRED" });
    const now = Date.now();
    const granted = args.decision === "marketing_granted";
    await ctx.db.insert("communicationConsents", { businessId: business._id, customerId: customer._id, identityKey: customer.identityKey, scope: "marketing", state: granted ? "granted" : "withdrawn", source: "seller_recorded", ...(evidence ? { evidence } : {}), policyVersion: COMMUNICATION_POLICY_VERSION, recordedBy: identity.subject, recordedAt: now });
    await ctx.db.patch(customer._id, granted ? { communicationState: "marketing_opted_in", marketingConsentAt: now, marketingConsentSource: "seller_recorded", marketingConsentEvidence: evidence, optedOutAt: undefined, optOutSource: undefined } : { communicationState: "opted_out", optedOutAt: now, optOutSource: "seller_recorded", marketingConsentAt: undefined, marketingConsentSource: undefined, marketingConsentEvidence: undefined });
    await ctx.db.insert("complianceAudit", { businessId: business._id, actor: identity.subject, action: granted ? "marketing_consent_recorded" : "communication_opt_out_recorded", subjectType: "consent", subjectRef: customer._id, at: now });
    return null;
  },
});

export const privacyRequests = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({ requestId: v.id("privacyRequests"), requestType, status: v.string(), requestedAt: v.number(), dueAt: v.number(), details: v.union(v.string(), v.null()) })),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const rows = await ctx.db.query("privacyRequests").withIndex("by_owner_time", (builder) => builder.eq("ownerSubject", identity.subject)).order("desc").take(20);
    return rows.filter((row) => row.businessId === args.businessId && row.requestType !== "account_deletion").map((row) => ({ requestId: row._id, requestType: row.requestType as "access" | "export" | "correction" | "restriction" | "objection" | "erasure", status: row.status, requestedAt: row.requestedAt, dueAt: row.dueAt, details: row.details ?? null }));
  },
});

export const createPrivacyRequest = mutation({
  args: { businessId: v.id("businesses"), requestType, details: v.optional(v.string()) },
  returns: v.id("privacyRequests"),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const details = args.details?.trim();
    if (details && details.length > 2_000) throw new ConvexError({ code: "REQUEST_TOO_LONG" });
    const now = Date.now();
    const requestId = await ctx.db.insert("privacyRequests", { businessId: args.businessId, requesterType: "account_owner", ownerSubject: identity.subject, requestType: args.requestType, status: args.requestType === "export" ? "completed" : "open", ...(details ? { details } : {}), requestedAt: now, dueAt: now + 30 * 86_400_000, ...(args.requestType === "export" ? { completedAt: now, resolutionNote: "Self-service export available immediately." } : {}) });
    await ctx.db.insert("complianceAudit", { businessId: args.businessId, actor: identity.subject, action: `privacy_request_${args.requestType}`, subjectType: "privacy_request", subjectRef: requestId, at: now });
    return requestId;
  },
});

export const exportWorkspace = query({
  args: { businessId: v.id("businesses") },
  returns: v.object({ generatedAt: v.number(), business: v.object({ name: v.string(), timezone: v.string(), retentionDays: v.number() }), customers: v.array(v.object({ name: v.union(v.string(), v.null()), identity: v.string(), communicationState: v.string(), lastInteraction: v.number() })), orders: v.array(v.object({ totalAmount: v.number(), status: v.string(), createdAt: v.number() })), messages: v.array(v.object({ customerId: v.id("customers"), role: v.string(), content: v.string(), timestamp: v.number() })), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const customers = await ctx.db.query("customers").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).take(500);
    const orders = await ctx.db.query("orders").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).take(500);
    const messages = await ctx.db.query("interactions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).take(2_000);
    return {
      generatedAt: Date.now(),
      business: { name: business.name, timezone: business.timezone ?? "Africa/Lagos", retentionDays: business.messageRetentionDays ?? 90 },
      customers: customers.filter((customer) => customer.deletedAt === undefined).map((customer) => ({ name: customer.name ?? null, identity: customer.phone, communicationState: customer.communicationState ?? (customer.firstInboundAt ? "service_only" : "unknown"), lastInteraction: customer.lastInteraction })),
      orders: orders.map((order) => ({ totalAmount: order.totalAmount, status: order.status, createdAt: order.createdAt })),
      messages: messages.map((message) => ({ customerId: message.customerId, role: message.role, content: message.content, timestamp: message.timestamp })),
      truncated: customers.length === 500 || orders.length === 500 || messages.length === 2_000,
    };
  },
});

export const deletionStatus = query({
  args: { businessId: v.id("businesses") },
  returns: v.union(v.null(), v.object({ state: v.string(), requestedAt: v.number(), completedAt: v.union(v.number(), v.null()), deletedRecords: v.number(), errorCode: v.union(v.string(), v.null()) })),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId, { allowReadOnly: true });
    const job = await ctx.db.query("adminAccountDeletionJobs").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).unique();
    return job ? { state: job.state, requestedAt: job.requestedAt, completedAt: job.completedAt ?? null, deletedRecords: job.deletedRecords, errorCode: job.errorCode ?? null } : null;
  },
});

export const accountDeletionPreparation = internalQuery({
  args: { ownerId: v.string() },
  returns: v.union(v.null(), v.object({ businessId: v.id("businesses"), businessName: v.string(), subscriptionStatus: v.union(v.string(), v.null()), subscriptionCode: v.union(v.string(), v.null()), emailTokenCiphertext: v.union(v.string(), v.null()) })),
  handler: async (ctx, args) => {
    const business = await ctx.db.query("businesses").withIndex("by_owner", (builder) => builder.eq("ownerId", args.ownerId)).unique();
    if (!business) return null;
    const subscription = await ctx.db.query("businessSubscriptions").withIndex("by_business", (builder) => builder.eq("businessId", business._id)).unique();
    return { businessId: business._id, businessName: business.name, subscriptionStatus: subscription?.status ?? null, subscriptionCode: subscription?.providerSubscriptionCode ?? null, emailTokenCiphertext: subscription?.providerEmailTokenCiphertext ?? null };
  },
});

export const requestAccountDeletion = action({
  args: { businessId: v.id("businesses"), confirmation: v.string() },
  returns: v.id("adminAccountDeletionJobs"),
  handler: async (ctx, args): Promise<Id<"adminAccountDeletionJobs">> => {
    const identity = await requireIdentity(ctx);
    const preparation = await ctx.runQuery(internal.compliance.accountDeletionPreparation, { ownerId: identity.subject });
    if (!preparation || preparation.businessId !== args.businessId) throw new ConvexError({ code: "NOT_FOUND" });
    if (args.confirmation !== preparation.businessName) throw new ConvexError({ code: "DELETION_CONFIRMATION_MISMATCH" });
    if (preparation.subscriptionStatus && ["active", "past_due", "cancel_at_period_end"].includes(preparation.subscriptionStatus)) {
      if (!preparation.subscriptionCode || !preparation.emailTokenCiphertext) throw new ConvexError({ code: "BILLING_PROVIDER_SYNC_PENDING" });
      const emailToken = await decryptSecret(preparation.emailTokenCiphertext, `billing:${preparation.businessId}:paystack-email-token`);
      await paystackRequest("/subscription/disable", { method: "POST", body: { code: preparation.subscriptionCode, token: emailToken } });
    }
    return await ctx.runMutation(internal.adminDeletion.beginAccountDeletion, { businessId: preparation.businessId, requestedBy: identity.subject });
  },
});
