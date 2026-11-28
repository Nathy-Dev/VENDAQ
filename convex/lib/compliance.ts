import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const LEGAL_VERSIONS = {
  terms: "2026-11-23",
  privacy: "2026-11-23",
  dpa: "2026-11-23",
  billing: "2026-11-23",
  acceptable_use: "2026-11-23",
} as const;

export const COMMUNICATION_POLICY_VERSION = "2026-11-23";

export type LegalDocument = keyof typeof LEGAL_VERSIONS;

export const requiredAccountDocuments: LegalDocument[] = ["terms", "privacy", "acceptable_use"];
export const requiredBusinessDocuments: LegalDocument[] = ["dpa"];
export const requiredCheckoutDocuments: LegalDocument[] = ["billing"];

export async function latestLegalAcceptance(ctx: QueryCtx | MutationCtx, subject: string, document: LegalDocument) {
  return await ctx.db.query("legalAcceptances")
    .withIndex("by_subject_document", (builder) => builder.eq("subject", subject).eq("document", document))
    .order("desc")
    .first();
}

export async function hasCurrentLegalAcceptance(ctx: QueryCtx | MutationCtx, subject: string, document: LegalDocument): Promise<boolean> {
  const acceptance = await latestLegalAcceptance(ctx, subject, document);
  return acceptance?.version === LEGAL_VERSIONS[document];
}

export async function requireCurrentLegalAcceptance(ctx: QueryCtx | MutationCtx, subject: string, documents: LegalDocument[]): Promise<void> {
  for (const document of documents) {
    if (!await hasCurrentLegalAcceptance(ctx, subject, document)) {
      throw new ConvexError({ code: "LEGAL_ACCEPTANCE_REQUIRED", document, version: LEGAL_VERSIONS[document] });
    }
  }
}

export function isOptOutKeyword(content: string): boolean {
  const normalized = content.trim().toLowerCase().replace(/[.!?,;:]+$/g, "");
  return ["stop", "unsubscribe", "cancel messages", "opt out", "don't message me", "dont message me", "no more messages"].includes(normalized);
}

export function isMarketingOptInKeyword(content: string): boolean {
  const normalized = content.trim().toLowerCase().replace(/[.!?,;:]+$/g, "");
  return ["start", "subscribe", "send me offers", "marketing yes", "opt in"].includes(normalized);
}

export async function latestCommunicationConsent(
  ctx: QueryCtx | MutationCtx,
  businessId: Id<"businesses">,
  identityKey: string,
  scope: "service" | "marketing",
): Promise<Doc<"communicationConsents"> | null> {
  return await ctx.db.query("communicationConsents")
    .withIndex("by_business_identity_scope_time", (builder) => builder.eq("businessId", businessId).eq("identityKey", identityKey).eq("scope", scope))
    .order("desc")
    .first();
}

export async function canSendServiceMessage(ctx: QueryCtx | MutationCtx, customer: Doc<"customers">): Promise<boolean> {
  if (customer.deletedAt !== undefined || customer.communicationState === "opted_out") return false;
  const latest = customer.identityKey ? await latestCommunicationConsent(ctx, customer.businessId, customer.identityKey, "service") : null;
  if (latest?.state === "withdrawn") return false;
  if (customer.firstInboundAt !== undefined || customer.lastInboundAt !== undefined) return true;
  // Pre-consent-ledger records can still prove a customer-initiated service
  // conversation from their retained inbound interaction history.
  const inbound = await ctx.db.query("interactions")
    .withIndex("by_customer", (builder) => builder.eq("customerId", customer._id))
    .order("desc")
    .first();
  return inbound?.businessId === customer.businessId && inbound.role === "customer" && !inbound.metaHistorical;
}

export async function canSendMarketingMessage(ctx: QueryCtx | MutationCtx, customer: Doc<"customers">): Promise<boolean> {
  if (!customer.identityKey || customer.deletedAt !== undefined || customer.communicationState !== "marketing_opted_in") return false;
  const latest = await latestCommunicationConsent(ctx, customer.businessId, customer.identityKey, "marketing");
  return latest?.state === "granted";
}
