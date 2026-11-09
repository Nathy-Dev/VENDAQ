import { internalMutation, internalQuery } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { foundationPolicy } from "./lib/policy";

// Internal mutation: only callable from actions, not from the client
export const insertUser = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    hashedPassword: v.string(),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (existingUser) {
      throw new ConvexError({ code: "ACCOUNT_CREATION_UNAVAILABLE" });
    }

    const userId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      password: args.hashedPassword,
    });

    return userId;
  },
});

// Internal query: only callable from actions
export const getUserByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.null(), v.object({ _id: v.id("users"), _creationTime: v.number(), name: v.optional(v.string()), email: v.optional(v.string()), emailVerified: v.optional(v.number()), image: v.optional(v.string()), password: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
  },
});

// Global and account limits are one transaction, so concurrent attempts cannot
// all pass a read-then-increment race. Keys contain hashes, never email addresses.
export const consumeAuthAttempt = internalMutation({
  args: { key: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const policy = foundationPolicy();
    let permitted = true;
    for (const [key, limit] of [["global", policy.authGlobalLimit], [args.key, policy.authAccountLimit]] as const) {
      const existing = await ctx.db.query("authAttempts").withIndex("by_key", (builder) => builder.eq("key", key)).unique();
      const active = existing && existing.windowStart + policy.authWindowMs > Date.now();
      const count = active ? existing.count + 1 : 1;
      const windowStart = active ? existing.windowStart : Date.now();
      if (count > limit) permitted = false;
      if (existing) await ctx.db.patch(existing._id, { count: Math.min(count, limit + 1), windowStart });
      else await ctx.db.insert("authAttempts", { key, count, windowStart });
    }
    return permitted;
  },
});
