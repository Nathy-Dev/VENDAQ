import { ConvexError } from "convex/values";
import type { UserIdentity } from "convex/server";
import { api } from "../_generated/api";
import type { ActionCtx, QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { billingAccess } from "./billingAccess";

export type IdentityCtx = Pick<QueryCtx, "auth" | "db"> | Pick<ActionCtx, "auth" | "runQuery">;

export async function trustedIdentity(ctx: Pick<QueryCtx, "auth">): Promise<UserIdentity | null> {
  const identity = await ctx.auth.getUserIdentity();
  const issuer = process.env.AUTH_JWT_ISSUER;
  return issuer && identity?.issuer === issuer && identity.subject ? identity : null;
}

export async function activeIdentity(ctx: IdentityCtx): Promise<UserIdentity | null> {
  const identity = await trustedIdentity(ctx);
  if (!identity || typeof identity.pipelixr_user_id !== "string") return null;
  if (!("db" in ctx)) return await ctx.runQuery(api.users.sessionActive, {}) ? identity : null;

  const userId = ctx.db.normalizeId("users", identity.pipelixr_user_id);
  const user = userId ? await ctx.db.get(userId) : null;
  if (!user) return null;
  if (identity.subject.startsWith("google:")) {
    return user.googleSubject === identity.subject ? identity : null;
  }
  return !user.googleSubject && user.password && identity.subject === `credentials:${user._id}` ? identity : null;
}

export async function requireIdentity(ctx: IdentityCtx) {
  const identity = await activeIdentity(ctx);
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity;
}

export async function requireBusiness(ctx: QueryCtx | MutationCtx, businessId: Id<"businesses">, options?: { allowReadOnly?: boolean }) {
  const identity = await requireIdentity(ctx);
  const business = await ctx.db.get(businessId);
  if (!business || business.ownerId !== identity.subject || business.foundationVersion !== 1) {
    throw new ConvexError({ code: "NOT_FOUND" });
  }
  if ("scheduler" in ctx && !options?.allowReadOnly) {
    const access = await billingAccess(ctx, business);
    if (access.readOnly) throw new ConvexError({ code: "BILLING_READ_ONLY" });
  }
  return business;
}
