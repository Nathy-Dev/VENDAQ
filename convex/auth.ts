"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import bcrypt from "bcryptjs";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { normalizeEmail, validatePassword } from "./lib/authentication";
import { sha256 } from "./lib/crypto";
import { ConvexError } from "convex/values";

// Public action: create a user with hashed password
export const createUser = action({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.string(),
  },
  returns: v.id("users"),
  handler: async (ctx, args): Promise<Id<"users">> => {
    const email = normalizeEmail(args.email);
    validatePassword(args.password, true);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 100) throw new ConvexError({ code: "INVALID_NAME" });
    // Commit limits before expensive hashing, including rejected attempts.
    const permitted = await ctx.runMutation(internal.users.consumeAuthAttempt, { key: await sha256(email) });
    if (!permitted) throw new ConvexError({ code: "AUTH_RATE_LIMITED" });
    const hashedPassword = await bcrypt.hash(args.password, 10);
    const userId = await ctx.runMutation(internal.users.insertUser, {
      name,
      email,
      hashedPassword,
    });
    return userId;
  },
});

// Public action: verify user credentials
export const verifyUser = action({
  args: {
    email: v.string(),
    password: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      name: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
    }),
    v.null()
  ),
  handler: async (ctx, args): Promise<{ id: string; name: string | null; email: string | null } | null> => {
    let email: string;
    try {
      email = normalizeEmail(args.email);
      validatePassword(args.password, false);
    } catch { return null; }
    const permitted = await ctx.runMutation(internal.users.consumeAuthAttempt, { key: await sha256(email) });
    if (!permitted) return null;
    const user = await ctx.runQuery(internal.users.getUserByEmail, { email });
    // Match bcrypt work for unknown accounts; never return an existence flag.
    const dummyHash = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
    const isValid = await bcrypt.compare(args.password, user?.password ?? dummyHash);
    if (!user || !user.password || !isValid) {
      return null;
    }

    return {
      id: user._id,
      name: user.name ?? null,
      email: user.email ?? null,
    };
  },
});
