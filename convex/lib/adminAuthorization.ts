import { ConvexError } from "convex/values";
import { activeIdentity, type IdentityCtx } from "./authorization";

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

export async function isAdmin(ctx: IdentityCtx) {
  const identity = await activeIdentity(ctx);
  if (!identity?.subject) return false;
  return adminSubjects().has(identity.subject);
}

export async function requireAdmin(ctx: IdentityCtx) {
  const identity = await activeIdentity(ctx);
  if (!identity?.subject || !adminSubjects().has(identity.subject)) {
    throw new ConvexError({ code: "ADMIN_FORBIDDEN" });
  }
  return identity;
}
