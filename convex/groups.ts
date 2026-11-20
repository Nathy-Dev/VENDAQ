import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireBusiness, requireIdentity } from "./lib/authorization";
import { decryptSecret, encryptSecret, sha256 } from "./lib/crypto";
import { providerAccountAliases, providerGroups, providerInstances, providerRequest } from "./lib/evolution";
import { BUSINESS_SYSTEM_PROMPT_MIN_LENGTH } from "./lib/launch";
import { groupGovernanceMode } from "./lib/groupGovernance";

const groupRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));
const governanceMode = v.union(v.literal("watch"), v.literal("suggest"), v.literal("mentions"), v.literal("common_questions"), v.literal("custom"));
const groupItem = v.object({
  groupJid: v.string(),
  groupName: v.string(),
  memberCount: v.number(),
  role: groupRole,
  isEnabled: v.boolean(),
  mentionOnly: v.boolean(),
  governanceMode,
  allowPrivateHandoff: v.boolean(),
  customInstructions: v.string(),
  lastRefreshedAt: v.union(v.number(), v.null()),
});

export const list = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(groupItem),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const groups = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", args.businessId)).take(500);
    return groups.map((group) => ({
      groupJid: group.groupJid,
      groupName: group.groupName ?? group.groupJid.split("@")[0],
      memberCount: group.memberCount ?? 0,
      role: group.role ?? "member",
      isEnabled: group.isEnabled,
      mentionOnly: group.mentionOnly ?? true,
      governanceMode: groupGovernanceMode(group),
      allowPrivateHandoff: group.allowPrivateHandoff ?? false,
      customInstructions: group.customInstructions ?? "",
      lastRefreshedAt: group.lastRefreshedAt ?? null,
    })).sort((a, b) => Number(b.isEnabled) - Number(a.isEnabled) || ({ owner: 0, admin: 1, member: 2 }[a.role] - { owner: 0, admin: 1, member: 2 }[b.role]) || a.groupName.localeCompare(b.groupName));
  },
});

export const setEnabled = mutation({
  args: { businessId: v.id("businesses"), groupJid: v.string(), isEnabled: v.boolean(), groupName: v.optional(v.string()), memberCount: v.optional(v.number()), role: v.optional(groupRole) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const business = await requireBusiness(ctx, args.businessId);
    if (!args.groupJid.endsWith("@g.us")) throw new ConvexError({ code: "INVALID_GROUP" });
    if (args.isEnabled && (!(business.groupAutoReplyEnabled ?? false) || (business.businessSystemPrompt?.trim().length ?? 0) < BUSINESS_SYSTEM_PROMPT_MIN_LENGTH)) {
      throw new ConvexError({ code: "GROUP_ASSISTANT_NOT_READY" });
    }
    const group = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", args.businessId).eq("groupJid", args.groupJid)).unique();
    if (!group) throw new ConvexError({ code: "GROUP_NOT_FOUND" });
    await ctx.db.patch(group._id, { isEnabled: args.isEnabled, enabledAt: args.isEnabled ? Date.now() : undefined, updatedAt: Date.now() });
    return null;
  },
});

export const setMentionOnly = mutation({
  args: { businessId: v.id("businesses"), groupJid: v.string(), mentionOnly: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const group = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", args.businessId).eq("groupJid", args.groupJid)).unique();
    if (!group) throw new ConvexError({ code: "GROUP_NOT_FOUND" });
    await ctx.db.patch(group._id, { mentionOnly: args.mentionOnly, updatedAt: Date.now() });
    return null;
  },
});

export const setGovernance = mutation({
  args: { businessId: v.id("businesses"), groupJid: v.string(), mode: governanceMode, allowPrivateHandoff: v.boolean(), customInstructions: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBusiness(ctx, args.businessId);
    const group = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", args.businessId).eq("groupJid", args.groupJid)).unique();
    if (!group) throw new ConvexError({ code: "GROUP_NOT_FOUND" });
    const customInstructions = args.customInstructions?.replaceAll("\u0000", "").trim() ?? "";
    if (customInstructions.length > 1_000 || (args.mode === "custom" && customInstructions.length < 10)) throw new ConvexError({ code: "INVALID_GROUP_INSTRUCTIONS" });
    await ctx.db.patch(group._id, {
      governanceMode: args.mode,
      mentionOnly: args.mode === "mentions" || args.mode === "suggest" || args.mode === "watch",
      allowPrivateHandoff: args.allowPrivateHandoff,
      customInstructions: customInstructions || undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const authorizeRefresh = internalQuery({
  args: { businessId: v.id("businesses"), ownerId: v.string() },
  returns: v.object({ sessionId: v.id("whatsappSessions"), generation: v.number(), tokenCiphertext: v.string(), tokenHash: v.string(), providerInstanceId: v.string() }),
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business || business.ownerId !== args.ownerId || business.foundationVersion !== 1) throw new ConvexError({ code: "NOT_FOUND" });
    const session = await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", args.businessId)).unique();
    if (!session || session.state !== "connected" || !session.providerInstanceId) throw new ConvexError({ code: "WHATSAPP_NOT_CONNECTED" });
    return { sessionId: session._id, generation: session.generation, tokenCiphertext: session.tokenCiphertext, tokenHash: session.tokenHash, providerInstanceId: session.providerInstanceId };
  },
});

export const upsertFromProvider = internalMutation({
  args: { businessId: v.id("businesses"), groups: v.array(v.object({ jid: v.string(), name: v.string(), memberCount: v.number(), role: groupRole })) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const group of args.groups.slice(0, 500)) {
      const existing = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", args.businessId).eq("groupJid", group.jid)).unique();
      if (existing) {
        await ctx.db.patch(existing._id, { groupName: group.name, memberCount: group.memberCount, role: group.role, lastRefreshedAt: now, updatedAt: now });
      } else {
        await ctx.db.insert("managedGroups", { businessId: args.businessId, groupJid: group.jid, groupName: group.name, memberCount: group.memberCount, role: group.role, isEnabled: false, mentionOnly: true, governanceMode: "mentions", allowPrivateHandoff: false, lastRefreshedAt: now, addedAt: now, updatedAt: now });
      }
    }
    return args.groups.length;
  },
});

export const upsertDiscovered = internalMutation({
  args: { businessId: v.id("businesses"), groupJid: v.string(), groupName: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", args.businessId).eq("groupJid", args.groupJid)).unique();
    if (!existing) await ctx.db.insert("managedGroups", { businessId: args.businessId, groupJid: args.groupJid, groupName: args.groupName, role: "member", isEnabled: false, mentionOnly: true, governanceMode: "mentions", allowPrivateHandoff: false, addedAt: Date.now(), updatedAt: Date.now() });
    return null;
  },
});

export const refresh = action({
  args: { businessId: v.id("businesses") },
  returns: v.object({ refreshed: v.number() }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const session = await ctx.runQuery(internal.groups.authorizeRefresh, { businessId: args.businessId, ownerId: identity.subject });
    const storedToken = await decryptSecret(session.tokenCiphertext, `business:${args.businessId}:session-token`);
    const instancesResult = await providerRequest("GET", "/instance/all");
    const providerInstance = providerInstances(instancesResult).find((instance) => instance.id === session.providerInstanceId);
    const token = providerInstance?.token || storedToken;
    if (token !== storedToken) {
      await ctx.runMutation(internal.foundation.repairSessionCredential, {
        sessionId: session.sessionId,
        generation: session.generation,
        providerInstanceId: session.providerInstanceId,
        expectedTokenHash: session.tokenHash,
        tokenCiphertext: await encryptSecret(token, `business:${args.businessId}:session-token`),
        tokenHash: await sha256(token),
      });
    }
    const result = await providerRequest("GET", "/group/list", { token, instanceId: session.providerInstanceId });
    const connectedJid = providerInstance?.jid ?? "";
    const accountResult = connectedJid ? await providerRequest("POST", "/user/info", { token, instanceId: session.providerInstanceId, body: { number: [connectedJid], formatJid: false } }) : { data: { Users: {} } };
    const groups = providerGroups(result, [connectedJid, ...providerAccountAliases(accountResult)]);
    await ctx.runMutation(internal.groups.upsertFromProvider, { businessId: args.businessId, groups });
    return { refreshed: groups.length };
  },
});

// Legacy names stay exported so the dormant pre-foundation UI keeps compiling.
export const listGroupsForBusiness = list;
export const setGroupEnabled = setEnabled;
export const setGroupMentionOnly = setMentionOnly;
export const refreshGroups = refresh;
