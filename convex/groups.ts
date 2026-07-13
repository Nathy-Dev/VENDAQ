/**
 * Groups & Communities — owner-controlled AI scope.
 *
 * By default the Pipelixr assistant stays silent in ALL WhatsApp groups. The
 * owner explicitly opts specific groups in from Settings → Groups & Communities,
 * and only those opted-in groups get AI classification and auto-replies.
 *
 * Discovery strategy (see refreshGroups):
 *   1. Ask Evolution Go for the full group list (fetchAllGroups).
 *      → Preferred: gives us name, member count, and the user's role.
 *   2. Fall back to groups we've already seen in inbound webhooks
 *      (customers.isGroup=true), so we still show *something* if Evolution Go's
 *      group endpoint isn't exposed on this build.
 *
 * By default only groups where the connected number is owner/admin surface in
 * the UI; users can opt into "Show all groups" for the full list.
 */

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import * as evoClient from "./evolutionGoClient";

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Lists every group the assistant knows about for this business, along with
 * whether the owner has opted the assistant in.
 *
 * The UI filters this on the client into "Groups you manage" (owner/admin) and
 * "All other groups" (member-only), so we return the whole list here.
 */
export const listGroupsForBusiness = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    // 1. Pull the managed-group records the owner has interacted with.
    const managed = await ctx.db
      .query("managedGroups")
      .withIndex("by_business_group", (q) => q.eq("businessId", args.businessId))
      .collect();

    // 2. Also pull group customers (groups we've received messages in). This
    //    covers the "we've never fetched from Evolution Go" case — the group
    //    still shows up because someone messaged in it.
    const groupCustomers = await ctx.db
      .query("customers")
      .withIndex("by_business_phone", (q) => q.eq("businessId", args.businessId))
      .filter((q) => q.eq(q.field("isGroup"), true))
      .collect();

    // Merge by JID. `managedGroups` is the source of truth for the toggle,
    // `customers` is the source of truth for last-seen activity.
    const byJid = new Map<string, {
      groupJid: string;
      groupName: string;
      memberCount: number;
      role: "owner" | "admin" | "member" | "unknown";
      isEnabled: boolean;
      mentionOnly: boolean;
      lastActivityAt: number | null;
      managedGroupId: string | null;
    }>();

    for (const c of groupCustomers) {
      byJid.set(c.phone, {
        groupJid: c.phone,
        groupName: c.name || c.phone.split("@")[0],
        memberCount: c.groupMetadata?.participants?.length ?? 0,
        role: "unknown",
        isEnabled: false,
        mentionOnly: true,
        lastActivityAt: c.lastInteraction ?? null,
        managedGroupId: null,
      });
    }

    for (const m of managed) {
      const prev = byJid.get(m.groupJid);
      byJid.set(m.groupJid, {
        groupJid: m.groupJid,
        groupName: m.groupName || prev?.groupName || m.groupJid.split("@")[0],
        memberCount: m.memberCount ?? prev?.memberCount ?? 0,
        role: (m.role as "owner" | "admin" | "member") || prev?.role || "unknown",
        isEnabled: m.isEnabled,
        mentionOnly: m.mentionOnly ?? true,
        lastActivityAt: prev?.lastActivityAt ?? null,
        managedGroupId: m._id,
      });
    }

    return Array.from(byJid.values()).sort((a, b) => {
      // Sort: enabled first, then owned/admin, then by last activity desc.
      if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1;
      const rolePriority = { owner: 0, admin: 1, member: 2, unknown: 3 };
      if (rolePriority[a.role] !== rolePriority[b.role]) {
        return rolePriority[a.role] - rolePriority[b.role];
      }
      return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
    });
  },
});

/**
 * Fast check used by the AI pipeline: is this specific group opted in?
 * Returns `null` if not opted in (assistant should stay silent), otherwise
 * returns the ManagedGroup record with the reply rules.
 */
export const getManagedGroup = query({
  args: { businessId: v.id("businesses"), groupJid: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("managedGroups")
      .withIndex("by_business_group", (q) =>
        q.eq("businessId", args.businessId).eq("groupJid", args.groupJid)
      )
      .unique();
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Turns AI on/off for a single group. Called from the settings UI when the
 * owner flips a toggle. Creates the ManagedGroup row if it doesn't exist yet
 * (e.g. first time the owner enables a group discovered from inbound traffic).
 */
export const setGroupEnabled = mutation({
  args: {
    businessId: v.id("businesses"),
    groupJid: v.string(),
    isEnabled: v.boolean(),
    // Optional metadata to seed the row on first-enable.
    groupName: v.optional(v.string()),
    memberCount: v.optional(v.number()),
    role: v.optional(v.union(v.literal("owner"), v.literal("admin"), v.literal("member"))),
  },
  handler: async (ctx, args) => {
    if (!args.groupJid.endsWith("@g.us")) {
      throw new Error("Only WhatsApp groups (JIDs ending in @g.us) can be managed.");
    }

    const existing = await ctx.db
      .query("managedGroups")
      .withIndex("by_business_group", (q) =>
        q.eq("businessId", args.businessId).eq("groupJid", args.groupJid)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isEnabled: args.isEnabled,
        ...(args.groupName !== undefined ? { groupName: args.groupName } : {}),
        ...(args.memberCount !== undefined ? { memberCount: args.memberCount } : {}),
        ...(args.role !== undefined ? { role: args.role } : {}),
      });
      return existing._id;
    }

    return await ctx.db.insert("managedGroups", {
      businessId: args.businessId,
      groupJid: args.groupJid,
      groupName: args.groupName,
      memberCount: args.memberCount,
      role: args.role,
      isEnabled: args.isEnabled,
      mentionOnly: true, // safe default — user can toggle per group
      addedAt: Date.now(),
    });
  },
});

/**
 * Owner picks whether the assistant only replies when tagged, or on any buying
 * signal in the group. Community groups → mention-only. Personal storefront
 * groups → often "reply to any buying signal".
 */
export const setGroupMentionOnly = mutation({
  args: {
    businessId: v.id("businesses"),
    groupJid: v.string(),
    mentionOnly: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("managedGroups")
      .withIndex("by_business_group", (q) =>
        q.eq("businessId", args.businessId).eq("groupJid", args.groupJid)
      )
      .unique();

    if (!existing) {
      // The user is trying to configure a group they haven't opted in yet.
      // Create it as disabled so the setting is preserved for when they enable.
      await ctx.db.insert("managedGroups", {
        businessId: args.businessId,
        groupJid: args.groupJid,
        isEnabled: false,
        mentionOnly: args.mentionOnly,
        addedAt: Date.now(),
      });
      return;
    }

    await ctx.db.patch(existing._id, { mentionOnly: args.mentionOnly });
  },
});

/**
 * Internal — used by refreshGroups action to bulk-upsert Evolution Go's
 * group list. Preserves existing owner toggles (never flips isEnabled back
 * to false on refresh).
 */
export const upsertGroupsFromEvolution = mutation({
  args: {
    businessId: v.id("businesses"),
    groups: v.array(v.object({
      jid: v.string(),
      name: v.string(),
      memberCount: v.number(),
      role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const g of args.groups) {
      const existing = await ctx.db
        .query("managedGroups")
        .withIndex("by_business_group", (q) =>
          q.eq("businessId", args.businessId).eq("groupJid", g.jid)
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          groupName: g.name,
          memberCount: g.memberCount,
          role: g.role,
          lastRefreshedAt: now,
        });
      } else {
        await ctx.db.insert("managedGroups", {
          businessId: args.businessId,
          groupJid: g.jid,
          groupName: g.name,
          memberCount: g.memberCount,
          role: g.role,
          isEnabled: false, // safe default — owner must explicitly opt in
          mentionOnly: true,
          lastRefreshedAt: now,
          addedAt: now,
        });
      }
    }
    return { upserted: args.groups.length };
  },
});

// ─── Actions ────────────────────────────────────────────────────────────────

/**
 * Calls Evolution Go to refresh the group list. Called from the settings UI
 * when the owner clicks "Refresh groups". Falls back gracefully if the
 * Evolution Go build doesn't support /group/fetchAllGroups.
 */
export const refreshGroups = action({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<{ refreshed: number; source: "evolution" | "cache_only" }> => {
    const business = await ctx.runQuery(api.businesses.getBusinessById, {
      businessId: args.businessId,
    });
    if (!business?.evolutionInstanceName) {
      return { refreshed: 0, source: "cache_only" };
    }

    const groups = await evoClient.fetchAllGroups(business.evolutionInstanceName);
    if (groups.length === 0) {
      // Endpoint not available or genuinely no groups. UI still shows any
      // groups we've seen in inbound traffic (listGroupsForBusiness merges both).
      return { refreshed: 0, source: "cache_only" };
    }

    await ctx.runMutation(api.groups.upsertGroupsFromEvolution, {
      businessId: args.businessId,
      groups: groups.map((g) => ({
        jid: g.jid,
        name: g.name,
        memberCount: g.memberCount,
        role: g.role,
      })),
    });

    return { refreshed: groups.length, source: "evolution" };
  },
});
