import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function requireIdentity(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  const issuer = process.env.AUTH_JWT_ISSUER;
  if (!issuer || !identity || identity.issuer !== issuer || !identity.subject) {
    throw new ConvexError({ code: "UNAUTHENTICATED" });
  }
  return identity;
}

export async function requireBusiness(ctx: QueryCtx | MutationCtx, businessId: Id<"businesses">) {
  const identity = await requireIdentity(ctx);
  const business = await ctx.db.get(businessId);
  if (!business || business.ownerId !== identity.subject || business.foundationVersion !== 1) {
    throw new ConvexError({ code: "NOT_FOUND" });
  }
  return business;
}
