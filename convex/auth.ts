"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import bcrypt from "bcryptjs";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Public action: create a user with hashed password
export const createUser = action({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.string(),
  },
  returns: v.id("users"),
  handler: async (ctx, args): Promise<Id<"users">> => {
    const hashedPassword = await bcrypt.hash(args.password, 10);
    const userId = await ctx.runMutation(internal.users.insertUser, {
      name: args.name,
      email: args.email,
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
    const user = await ctx.runQuery(internal.users.getUserByEmail, { email: args.email });

    if (!user || !user.password) {
      return null;
    }

    const isValid = await bcrypt.compare(args.password, user.password);

    if (!isValid) {
      return null;
    }

    return {
      id: user._id,
      name: user.name ?? null,
      email: user.email ?? null,
    };
  },
});
