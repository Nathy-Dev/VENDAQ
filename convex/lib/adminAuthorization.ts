import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";

function adminSubjects() {
  return new Set(
    (process.env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function adminAccessConfigured() {
  return adminSubjects().size > 0;
}

export async function isAdmin(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) return false;
  return adminSubjects().has(identity.subject);
}

export async function requireAdmin(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject || !adminSubjects().has(identity.subject)) {
    throw new ConvexError({ code: "ADMIN_FORBIDDEN" });
  }
  return identity;
}
