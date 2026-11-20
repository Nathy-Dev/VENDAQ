import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Doc } from "./_generated/dataModel";
import { decryptSecret, encryptSecret, identityDigest, sha256 } from "./lib/crypto";
import { normalizeIdentity } from "./lib/events";
import { providerAccountAliases, providerContacts, providerGroups, providerIdentityMappings, providerInstances, providerRequest } from "./lib/evolution";

const contactItem = v.object({ jid: v.string(), name: v.string() });
const groupRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));
const groupItem = v.object({ jid: v.string(), name: v.string(), memberCount: v.number(), role: groupRole });
const mappingItem = v.object({ canonicalJid: v.string(), canonicalIdentityKey: v.string(), aliases: v.array(v.string()) });

const DIRECTORY_SYNC_INTERVAL_MS = 5 * 60_000;

export const authorize = internalQuery({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number() },
  returns: v.union(v.null(), v.object({
    businessId: v.id("businesses"),
    sessionId: v.id("whatsappSessions"),
    generation: v.number(),
    tokenCiphertext: v.string(),
    tokenHash: v.string(),
    providerInstanceId: v.string(),
  })),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.generation !== args.generation || session.state !== "connected" || !session.providerInstanceId) return null;
    const business = await ctx.db.get(session.businessId);
    if (!business || business.foundationVersion !== 1) return null;
    return {
      businessId: business._id,
      sessionId: session._id,
      generation: session.generation,
      tokenCiphertext: session.tokenCiphertext,
      tokenHash: session.tokenHash,
      providerInstanceId: session.providerInstanceId,
    };
  },
});

export const markStarted = internalMutation({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number(), force: v.boolean() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.generation !== args.generation || session.state !== "connected") return null;
    const business = await ctx.db.get(session.businessId);
    if (!business || business.foundationVersion !== 1) return null;
    const now = Date.now();
    if (!args.force && (business.lastDirectorySyncAt ?? 0) > now - DIRECTORY_SYNC_INTERVAL_MS) return null;
    // Mark before provider IO so the minute sweep cannot fan out overlapping syncs.
    await ctx.db.patch(business._id, { lastDirectorySyncAt: now });
    return now;
  },
});

export const markSucceeded = internalMutation({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number(), syncedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.generation !== args.generation) return null;
    const business = await ctx.db.get(session.businessId);
    if (business?.foundationVersion === 1) await ctx.db.patch(business._id, { lastDirectorySyncAt: args.syncedAt });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number(), startedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.generation !== args.generation) return null;
    const business = await ctx.db.get(session.businessId);
    if (business?.foundationVersion === 1 && business.lastDirectorySyncAt === args.startedAt) await ctx.db.patch(business._id, { lastDirectorySyncAt: undefined });
    return null;
  },
});

export const capturedPrivateJids = internalQuery({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const customers = await ctx.db.query("customers").withIndex("by_business_last_interaction", (builder) => builder.eq("businessId", args.businessId)).order("desc").take(500);
    return [...new Set(customers.filter((customer) => customer.deletedAt === undefined && !customer.isGroup && customer.phone !== "deleted").map((customer) => customer.phone))];
  },
});

async function upsertAlias(ctx: MutationCtx, businessId: Id<"businesses">, jid: string, canonicalJid: string, canonicalIdentityKey: string | undefined, name: string, now: number) {
  const existing = await ctx.db.query("contactAliases").withIndex("by_business_jid", (builder) => builder.eq("businessId", businessId).eq("jid", jid)).unique();
  if (existing) await ctx.db.patch(existing._id, { canonicalJid, ...(canonicalIdentityKey ? { canonicalIdentityKey } : {}), ...(name ? { name } : {}), updatedAt: now });
  else await ctx.db.insert("contactAliases", { businessId, jid, canonicalJid, ...(canonicalIdentityKey ? { canonicalIdentityKey } : {}), ...(name ? { name } : {}), updatedAt: now });
}

export const apply = internalMutation({
  args: { businessId: v.id("businesses"), contacts: v.array(contactItem), mappings: v.array(mappingItem), groups: v.array(groupItem) },
  returns: v.object({ contacts: v.number(), groups: v.number() }),
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business || business.foundationVersion !== 1) return { contacts: 0, groups: 0 };
    const now = Date.now();
    const names = new Map(args.contacts.map((contact) => [contact.jid, contact.name]));
    for (const contact of args.contacts.slice(0, 10_000)) {
      let canonicalJid: string;
      try { canonicalJid = normalizeIdentity(contact.jid); } catch { continue; }
      if (!canonicalJid.endsWith("@s.whatsapp.net")) continue;
      await upsertAlias(ctx, args.businessId, canonicalJid, canonicalJid, undefined, contact.name, now);
      const customer = await ctx.db.query("customers").withIndex("by_business_phone", (builder) => builder.eq("businessId", args.businessId).eq("phone", canonicalJid)).unique();
      if (customer && customer.deletedAt === undefined) await ctx.db.patch(customer._id, { name: contact.name });
    }
    for (const mapping of args.mappings.slice(0, 1_000)) {
      const name = names.get(mapping.canonicalJid) ?? "";
      const aliases = [...new Set([mapping.canonicalJid, ...mapping.aliases])];
      const customers: Doc<"customers">[] = [];
      for (const jid of aliases) {
        await upsertAlias(ctx, args.businessId, jid, mapping.canonicalJid, mapping.canonicalIdentityKey, name, now);
        const customer = await ctx.db.query("customers").withIndex("by_business_phone", (builder) => builder.eq("businessId", args.businessId).eq("phone", jid)).unique();
        if (customer && customer.deletedAt === undefined) {
          customers.push(customer);
          if (name && customer.name !== name) await ctx.db.patch(customer._id, { name });
        }
      }
      // If only one stored profile represents these aliases, canonicalize it in
      // place. If both LID and phone profiles exist, keep both records/history;
      // the inbox query combines them under the canonical phone thread.
      const distinct = [...new Map(customers.map((customer) => [customer._id, customer])).values()];
      if (distinct.length === 1 && (distinct[0].phone !== mapping.canonicalJid || distinct[0].identityKey !== mapping.canonicalIdentityKey)) {
        await ctx.db.patch(distinct[0]._id, { phone: mapping.canonicalJid, identityKey: mapping.canonicalIdentityKey, ...(name ? { name } : {}) });
        const conversations = await ctx.db.query("conversations").withIndex("by_customer", (builder) => builder.eq("customerId", distinct[0]._id)).take(10);
        for (const conversation of conversations) await ctx.db.patch(conversation._id, { identityKey: mapping.canonicalIdentityKey });
      }
    }
    for (const group of args.groups.slice(0, 500)) {
      const existing = await ctx.db.query("managedGroups").withIndex("by_business_group", (builder) => builder.eq("businessId", args.businessId).eq("groupJid", group.jid)).unique();
      if (existing) await ctx.db.patch(existing._id, { groupName: group.name, memberCount: group.memberCount, role: group.role, lastRefreshedAt: now, updatedAt: now });
      else await ctx.db.insert("managedGroups", { businessId: args.businessId, groupJid: group.jid, groupName: group.name, memberCount: group.memberCount, role: group.role, isEnabled: false, mentionOnly: true, lastRefreshedAt: now, addedAt: now, updatedAt: now });
      const customer = await ctx.db.query("customers").withIndex("by_business_phone", (builder) => builder.eq("businessId", args.businessId).eq("phone", group.jid)).unique();
      if (customer && customer.deletedAt === undefined) await ctx.db.patch(customer._id, { name: group.name, isGroup: true });
    }
    return { contacts: args.contacts.length, groups: args.groups.length };
  },
});

export const sync = internalAction({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number(), force: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authorized = await ctx.runQuery(internal.directorySync.authorize, args);
    if (!authorized) return null;
    const startedAt = await ctx.runMutation(internal.directorySync.markStarted, { sessionId: args.sessionId, generation: args.generation, force: args.force ?? false });
    if (startedAt === null) return null;
    try {
      const storedToken = await decryptSecret(authorized.tokenCiphertext, `business:${authorized.businessId}:session-token`);
      const listing = await providerRequest("GET", "/instance/all");
      const providerInstance = providerInstances(listing).find((instance) => instance.id === authorized.providerInstanceId);
      const token = providerInstance?.token || storedToken;
      if (token !== storedToken) {
        await ctx.runMutation(internal.foundation.repairSessionCredential, {
          sessionId: authorized.sessionId,
          generation: authorized.generation,
          providerInstanceId: authorized.providerInstanceId,
          expectedTokenHash: authorized.tokenHash,
          tokenCiphertext: await encryptSecret(token, `business:${authorized.businessId}:session-token`),
          tokenHash: await sha256(token),
        });
      }
      const connectedJid = providerInstance?.jid ?? "";
      const [contactsResult, accountResult, groupsResult] = await Promise.all([
        providerRequest("GET", "/user/contacts", { token, instanceId: authorized.providerInstanceId, timeoutMs: 25_000 }),
        connectedJid ? providerRequest("POST", "/user/info", { token, instanceId: authorized.providerInstanceId, body: { number: [connectedJid], formatJid: false } }) : Promise.resolve({ data: { Users: {} } }),
        providerRequest("GET", "/group/list", { token, instanceId: authorized.providerInstanceId, timeoutMs: 25_000 }),
      ]);
      const aliases = [connectedJid, ...providerAccountAliases(accountResult)];
      const allContacts = providerContacts(contactsResult);
      const groups = providerGroups(groupsResult, aliases);
      const capturedJids = await ctx.runQuery(internal.directorySync.capturedPrivateJids, { businessId: authorized.businessId });
      const accountResults = await Promise.all(Array.from({ length: Math.ceil(capturedJids.length / 100) }, (_, index) => {
        const number = capturedJids.slice(index * 100, index * 100 + 100);
        return number.length ? providerRequest("POST", "/user/info", { token, instanceId: authorized.providerInstanceId, body: { number, formatJid: false }, timeoutMs: 25_000 }) : Promise.resolve({ data: { Users: {} } });
      }));
      const rawMappings = accountResults.flatMap(providerIdentityMappings);
      const mappings = await Promise.all(rawMappings.map(async (mapping) => ({ ...mapping, canonicalIdentityKey: await identityDigest(authorized.businessId, mapping.canonicalJid) })));
      const relevantJids = new Set([...capturedJids.filter((jid) => jid.endsWith("@s.whatsapp.net")), ...mappings.map((mapping) => mapping.canonicalJid)]);
      const contacts = allContacts.filter((contact) => relevantJids.has(contact.jid));
      await ctx.runMutation(internal.directorySync.apply, { businessId: authorized.businessId, contacts, mappings, groups });
      await ctx.runMutation(internal.directorySync.markSucceeded, { sessionId: authorized.sessionId, generation: authorized.generation, syncedAt: Date.now() });
    } catch {
      // A failed directory refresh must never degrade connection state or message ingestion.
      await ctx.runMutation(internal.directorySync.markFailed, { sessionId: authorized.sessionId, generation: authorized.generation, startedAt });
    }
    return null;
  },
});
