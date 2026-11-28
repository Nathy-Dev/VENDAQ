import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { recordConnectionTransition } from "./productAnalytics";
import { requireBusiness } from "./lib/authorization";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "./lib/crypto";
import { text } from "./lib/events";
import { exchangeMetaCode, graph, metaId, MetaError, metaSignupConfig, verifyMetaNumber, META_ATTEMPT_MS, META_DISCLOSURE, META_HEALTH_MS } from "./lib/meta";

const sessionArgs = { sessionId: v.id("whatsappSessions"), generation: v.number() };
const attemptArgs = { businessId: v.id("businesses"), attemptHash: v.string() };
const signupConfig = v.object({ appId: v.string(), configId: v.string(), version: v.string() });
const dormant = Number.MAX_SAFE_INTEGER;

export const config = query({
  args: { businessId: v.id("businesses") },
  returns: v.union(v.null(), signupConfig),
  handler: async (ctx, { businessId }) => {
    await requireBusiness(ctx, businessId);
    return metaSignupConfig();
  },
});

export const begin = action({
  args: { businessId: v.id("businesses"), accepted: v.boolean() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    if (!args.accepted || !metaSignupConfig()) throw new ConvexError({ code: "META_SIGNUP_UNAVAILABLE" });
    const attempt = randomToken();
    await ctx.runMutation(internal.metaConnections.beginAttempt, { businessId: args.businessId, attemptHash: await sha256(attempt) });
    return attempt;
  },
});

export const beginAttempt = internalMutation({
  args: attemptArgs, returns: v.null(),
  handler: async (ctx, { businessId, attemptHash }) => {
    await requireBusiness(ctx, businessId);
    const existing = await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", businessId)).unique();
    if (existing && existing.provider !== "meta" && (existing.state !== "disconnected" || existing.providerInstanceId)) throw new ConvexError({ code: "META_EXISTING_CONNECTION" });
    const now = Date.now();
    if (existing?.state === "connected" || (existing?.operationLeaseUntil ?? 0) > now) throw new ConvexError({ code: "META_CONNECTION_IN_PROGRESS" });
    const fields = {
      provider: "meta" as const, generation: (existing?.generation ?? 0) + 1, tokenHash: attemptHash, tokenCiphertext: "",
      state: "provisioning" as const, metaAttemptClaimed: false, operationLeaseUntil: now + META_ATTEMPT_MS,
      disclosureVersion: META_DISCLOSURE, consentAt: now, updatedAt: now, nextHealthAt: dormant,
    };
    const sessionId = existing?._id ?? await ctx.db.insert("whatsappSessions", { ...fields, businessId, instanceName: `meta-${businessId}`, createdAt: now });
    if (existing) await ctx.db.patch(sessionId, { ...fields, lastError: undefined, pairingMethod: undefined, lastHealthAt: undefined });
    await ctx.db.patch(businessId, { killSwitch: true, whatsappStatus: "pending" });
    await ctx.scheduler.runAfter(META_ATTEMPT_MS, internal.metaConnections.setupFailed, { sessionId, generation: fields.generation, code: "META_SIGNUP_EXPIRED" });
    return null;
  },
});

async function ownedAttempt(ctx: MutationCtx, { businessId, attemptHash }: { businessId: Doc<"businesses">["_id"]; attemptHash: string }) {
  await requireBusiness(ctx, businessId);
  const session = await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", businessId)).unique();
  if (!session || session.provider !== "meta" || session.state !== "provisioning" || session.tokenHash !== attemptHash || (session.operationLeaseUntil ?? 0) <= Date.now()) throw new ConvexError({ code: "META_SIGNUP_EXPIRED" });
  return session;
}

export const cancel = mutation({
  args: { businessId: v.id("businesses"), attempt: v.string() }, returns: v.null(),
  handler: async (ctx, { businessId, attempt }) => {
    if (!/^[\w-]{43}$/.test(attempt)) return null;
    const session = await ownedAttempt(ctx, { businessId, attemptHash: await sha256(attempt) });
    if (session.metaAttemptClaimed) return null;
    await ctx.db.patch(session._id, { state: "disconnected", tokenHash: "", operationLeaseUntil: undefined, updatedAt: Date.now() });
    await ctx.db.patch(businessId, { whatsappStatus: "disconnected" });
    return null;
  },
});

export const claim = internalMutation({
  args: attemptArgs, returns: v.object(sessionArgs),
  handler: async (ctx, args) => {
    const session = await ownedAttempt(ctx, args);
    if (session.metaAttemptClaimed) throw new ConvexError({ code: "META_SIGNUP_ALREADY_USED" });
    await ctx.db.patch(session._id, { metaAttemptClaimed: true });
    return { sessionId: session._id, generation: session.generation };
  },
});

export const stage = internalMutation({
  args: { ...attemptArgs, wabaId: v.string(), phoneId: v.string(), displayPhone: v.string(), tokenCiphertext: v.string() },
  returns: v.union(v.null(), v.literal("META_ASSET_ALREADY_BOUND"), v.literal("META_DISCONNECT_PREVIOUS_NUMBER")),
  handler: async (ctx, args) => {
    const session = await ownedAttempt(ctx, args);
    if (!session.metaAttemptClaimed) throw new ConvexError({ code: "META_SIGNUP_EXPIRED" });
    const [phone, account] = await Promise.all([
      ctx.db.query("whatsappSessions").withIndex("by_provider", (builder) => builder.eq("providerInstanceId", args.phoneId)).unique(),
      ctx.db.query("whatsappSessions").withIndex("by_meta_waba", (builder) => builder.eq("meta.wabaId", args.wabaId)).unique(),
    ]);
    if ((phone && phone._id !== session._id) || (account && account._id !== session._id)) return "META_ASSET_ALREADY_BOUND";
    if (session.meta && (session.meta.wabaId !== args.wabaId || session.providerInstanceId !== args.phoneId)) return "META_DISCONNECT_PREVIOUS_NUMBER";
    await ctx.db.patch(session._id, {
      providerInstanceId: args.phoneId, tokenCiphertext: args.tokenCiphertext, state: "pending", updatedAt: Date.now(),
      meta: session.meta ?? { wabaId: args.wabaId, displayPhone: args.displayPhone, contactsState: "pending", historyState: "pending" },
    });
    return null;
  },
});

export const activated = internalMutation({
  args: sessionArgs, returns: v.boolean(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.provider !== "meta" || session.generation !== args.generation || session.state !== "pending") return false;
    const now = Date.now();
    await ctx.db.patch(session._id, { state: "connected", operationLeaseUntil: undefined, updatedAt: now, lastError: undefined, lastHealthAt: now, nextHealthAt: now + META_HEALTH_MS });
    await ctx.db.patch(session.businessId, { whatsappStatus: "connected", whatsappMode: "official" });
    await recordConnectionTransition(ctx, { businessId: session.businessId, sessionId: session._id, previousState: session.state, currentState: "connected", at: now });
    await ctx.scheduler.runAfter(0, internal.metaConnections.sync, args);
    return true;
  },
});

export const setupFailed = internalMutation({
  args: { ...sessionArgs, code: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.generation !== args.generation || !["provisioning", "pending"].includes(session.state)) return null;
    await ctx.db.patch(session._id, { state: "error", generation: session.generation + 1, lastError: args.code, operationLeaseUntil: undefined, tokenCiphertext: "", tokenHash: "", updatedAt: Date.now() });
    await ctx.db.patch(session.businessId, { whatsappStatus: "error" });
    return null;
  },
});

export const complete = action({
  args: { businessId: v.id("businesses"), attempt: v.string(), code: v.string(), wabaId: v.string(), phoneId: v.string() },
  returns: v.object({ connected: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ connected: boolean; error?: string }> => {
    if (!metaSignupConfig() || !/^[\w-]{43}$/.test(args.attempt) || !metaId(args.wabaId) || !metaId(args.phoneId) || !/^[A-Za-z0-9._~-]{10,2048}$/.test(args.code)) return { connected: false, error: "META_INVALID_SIGNUP" };
    const attempt = { businessId: args.businessId, attemptHash: await sha256(args.attempt) };
    const operation = await ctx.runMutation(internal.metaConnections.claim, attempt);
    try {
      const token = await exchangeMetaCode(args.code);
      const displayPhone = await verifyMetaNumber(token, args.wabaId, args.phoneId);
      const tokenCiphertext = await encryptSecret(token, `business:${args.businessId}:session-token`);
      const stageError = await ctx.runMutation(internal.metaConnections.stage, { ...attempt, wabaId: args.wabaId, phoneId: args.phoneId, displayPhone, tokenCiphertext });
      if (stageError) throw new MetaError(stageError);
      const subscribed = await graph(`${args.wabaId}/subscribed_apps`, { method: "POST", token });
      if (subscribed.success !== true) throw new MetaError("META_SUBSCRIPTION_UNCONFIRMED");
      if (!await ctx.runMutation(internal.metaConnections.activated, operation)) return { connected: false, error: "META_SIGNUP_EXPIRED" };
      return { connected: true };
    } catch (error) {
      const data = error instanceof ConvexError ? error.data : null;
      const errorCode = error instanceof MetaError ? error.code : data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : "META_SETUP_FAILED";
      await ctx.runMutation(internal.metaConnections.setupFailed, { ...operation, code: errorCode });
      return { connected: false, error: errorCode };
    }
  },
});

async function stop(ctx: MutationCtx, session: Doc<"whatsappSessions">, release: boolean, code?: string) {
  const now = Date.now();
  await ctx.db.patch(session._id, {
    state: "disconnected", generation: session.generation + 1, tokenHash: "", tokenCiphertext: "", operationLeaseUntil: undefined,
    nextHealthAt: dormant, updatedAt: now, lastError: code,
    ...(release ? { providerInstanceId: undefined, meta: undefined } : {}),
  });
  await ctx.db.patch(session.businessId, { whatsappStatus: "disconnected", killSwitch: true });
  if (session.state !== "disconnected") await recordConnectionTransition(ctx, { businessId: session.businessId, sessionId: session._id, previousState: session.state, currentState: "disconnected", at: now, code });
}

export const disconnect = mutation({
  args: { businessId: v.id("businesses") }, returns: v.null(),
  handler: async (ctx, { businessId }) => {
    await requireBusiness(ctx, businessId, { allowReadOnly: true });
    const session = await ctx.db.query("whatsappSessions").withIndex("by_business", (builder) => builder.eq("businessId", businessId)).unique();
    if (session?.provider === "meta") await stop(ctx, session, false);
    return null;
  },
});

export const offboard = internalMutation({
  args: { wabaId: v.string(), phoneId: v.optional(v.string()), at: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.query("whatsappSessions").withIndex("by_meta_waba", (builder) => builder.eq("meta.wabaId", args.wabaId)).unique();
    if (!session || (args.phoneId && session.providerInstanceId !== args.phoneId) || args.at < Math.floor(session.consentAt / 1000) * 1000) return null;
    await stop(ctx, session, true, "META_OFFBOARDED");
    return null;
  },
});

export const source = internalQuery({
  args: { wabaId: v.string(), phoneId: v.string() },
  returns: v.union(v.null(), v.object({ ...sessionArgs, businessId: v.id("businesses"), tokenHash: v.string(), displayPhone: v.string(), connected: v.boolean() })),
  handler: async (ctx, args) => {
    const session = await ctx.db.query("whatsappSessions").withIndex("by_meta_waba", (builder) => builder.eq("meta.wabaId", args.wabaId)).unique();
    if (!session?.meta || session.providerInstanceId !== args.phoneId || !["pending", "connected"].includes(session.state)) return null;
    const business = await ctx.db.get(session.businessId);
    if (business?.foundationVersion !== 1) return null;
    return { sessionId: session._id, generation: session.generation, businessId: session.businessId, tokenHash: session.tokenHash, displayPhone: session.meta.displayPhone, connected: session.state === "connected" };
  },
});

const syncField = v.union(v.literal("contacts"), v.literal("history"));

export const claimSync = internalMutation({
  args: { ...sessionArgs, kind: syncField }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session?.meta || session.state !== "connected" || session.generation !== args.generation) return false;
    const state = args.kind === "contacts" ? "contactsState" : "historyState";
    if (session.meta[state] !== "pending") return false;
    await ctx.db.patch(session._id, { meta: { ...session.meta, [state]: "unconfirmed" } });
    return Date.now() - session.consentAt < 86_400_000;
  },
});

export const syncResult = internalMutation({
  args: { ...sessionArgs, kind: syncField, requestId: v.optional(v.string()), received: v.optional(v.boolean()), declined: v.optional(v.boolean()), progress: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session?.meta || session.generation !== args.generation || !["connected", "pending"].includes(session.state)) return null;
    const meta = { ...session.meta };
    if (args.kind === "contacts") {
      if (args.received) meta.contactsState = "received";
      if (args.requestId) { meta.contactsRequestId = args.requestId; if (meta.contactsState !== "received") meta.contactsState = "requested"; }
    } else {
      if (args.progress !== undefined) meta.historyProgress = Math.max(meta.historyProgress ?? 0, args.progress);
      if (meta.historyState !== "complete" && meta.historyState !== "declined") {
        if (args.declined) meta.historyState = "declined";
        else if (meta.historyProgress === 100) meta.historyState = "complete";
        else if (args.received) meta.historyState = "received";
        else if (args.requestId && meta.historyState !== "received") meta.historyState = "requested";
      }
      if (args.requestId) meta.historyRequestId = args.requestId;
    }
    await ctx.db.patch(session._id, { meta });
    return null;
  },
});

export const sync = internalAction({
  args: sessionArgs, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.runQuery(internal.foundation.sessionById, { sessionId: args.sessionId });
    if (!session?.meta || !session.providerInstanceId || session.generation !== args.generation || session.state !== "connected") return null;
    const token = await decryptSecret(session.tokenCiphertext, `business:${session.businessId}:session-token`);
    for (const kind of ["contacts", "history"] as const) {
      if (!await ctx.runMutation(internal.metaConnections.claimSync, { ...args, kind })) continue;
      try {
        const result = await graph(`${session.providerInstanceId}/smb_app_data`, { method: "POST", token, body: { messaging_product: "whatsapp", sync_type: kind === "contacts" ? "smb_app_state_sync" : "history" } });
        const requestId = text(result.request_id, 256);
        if (requestId) await ctx.runMutation(internal.metaConnections.syncResult, { ...args, kind, requestId });
      } catch {
        console.warn("meta_sync_unconfirmed", { sessionId: args.sessionId, kind });
      }
    }
    return null;
  },
});

export const healthResult = internalMutation({
  args: { ...sessionArgs, code: v.optional(v.string()), stopSending: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session?.meta || session.generation !== args.generation || session.state !== "connected") return null;
    if (args.stopSending) await stop(ctx, session, false, args.code);
    else await ctx.db.patch(session._id, { ...(args.code ? {} : { lastHealthAt: Date.now() }), lastError: args.code });
    return null;
  },
});

export const health = internalAction({
  args: sessionArgs, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.runQuery(internal.foundation.sessionById, { sessionId: args.sessionId });
    if (!session?.meta || !session.providerInstanceId || session.generation !== args.generation || session.state !== "connected") return null;
    try {
      const token = await decryptSecret(session.tokenCiphertext, `business:${session.businessId}:session-token`);
      const status = await graph(session.providerInstanceId, { token, params: { fields: "is_on_biz_app,platform_type" } });
      if (status.is_on_biz_app !== true || status.platform_type !== "CLOUD_API") throw new MetaError("META_COEXISTENCE_REQUIRED");
      await ctx.runMutation(internal.metaConnections.healthResult, { ...args, stopSending: false });
    } catch (error) {
      const code = error instanceof MetaError ? error.code : "META_HEALTH_UNAVAILABLE";
      await ctx.runMutation(internal.metaConnections.healthResult, { ...args, code, stopSending: ["META_AUTH_EXPIRED", "META_COEXISTENCE_REQUIRED"].includes(code) });
    }
    return null;
  },
});
