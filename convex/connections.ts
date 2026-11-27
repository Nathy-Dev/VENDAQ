import { v, type Infer, ConvexError } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { connectionState, pairingMethod, sessionDocument } from "./lib/validators";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "./lib/crypto";
import { logEvent } from "./lib/policy";
import { object } from "./lib/events";
import { providerRequest, providerDisplayName, providerInstanceId, providerInstances, providerConnectionState, providerErrorCode, providerQr, providerPairingCode } from "./lib/evolution";

const connectionResult = v.object({ state: connectionState, qr: v.union(v.string(), v.null()), error: v.union(v.string(), v.null()), pairingMethod: v.optional(pairingMethod), pairingCode: v.optional(v.string()), pairingCodeExpiresAt: v.optional(v.number()) });
type ConnectionResult = Infer<typeof connectionResult>;
type SessionDocument = Infer<typeof sessionDocument>;

function connectionErrorCode(error: unknown): string {
  if (error instanceof Error && ["ENCRYPTION_NOT_CONFIGURED", "INVALID_ENCRYPTION_CONFIGURATION", "INVALID_ENCRYPTION_KEY", "INVALID_CIPHERTEXT"].includes(error.message)) return "CONNECTION_SECURITY_UNAVAILABLE";
  return providerErrorCode(error);
}

const pairingSubscriptions = ["MESSAGE", "SEND_MESSAGE", "READ_RECEIPT", "CONNECTION", "QRCODE"];

async function pairingResult(session: SessionDocument): Promise<ConnectionResult> {
  const result: ConnectionResult = { state: session.state, qr: null, error: session.lastError ?? null };
  if (session.state !== "pending") return result;
  try {
    if (session.pairingMethod === "phone") {
      result.pairingMethod = "phone";
      if (session.pairingCodeCiphertext && session.pairingCodeExpiresAt && session.pairingCodeExpiresAt > Date.now()) {
        result.pairingCode = await decryptSecret(session.pairingCodeCiphertext, `session:${session._id}:pairing-code`);
        result.pairingCodeExpiresAt = session.pairingCodeExpiresAt;
      }
    } else if (session.qrCiphertext && (session.qrExpiresAt ?? 0) > Date.now()) {
      result.qr = await decryptSecret(session.qrCiphertext, `session:${session._id}:qr`);
    }
  } catch {
    result.error = "PAIRING_ARTIFACT_UNAVAILABLE";
  }
  return result;
}

async function repairProviderCredential(ctx: ActionCtx, session: SessionDocument, rejectedToken: string): Promise<string | null> {
  const matches = providerInstances(await providerRequest("GET", "/instance/all"))
    .filter((instance) => instance.id === session.providerInstanceId);
  if (matches.length !== 1 || !matches[0].token || matches[0].token === rejectedToken) return null;
  const token = matches[0].token;
  const tokenCiphertext = await encryptSecret(token, `business:${session.businessId}:session-token`);
  const tokenHash = await sha256(token);
  const repaired = await ctx.runMutation(internal.foundation.repairSessionCredential, {
    sessionId: session._id,
    generation: session.generation,
    providerInstanceId: session.providerInstanceId!,
    expectedTokenHash: session.tokenHash,
    tokenCiphertext,
    tokenHash,
  });
  return repaired ? token : null;
}

async function resetRevokedSession(ctx: ActionCtx, session: SessionDocument): Promise<ConnectionResult> {
  if (session.state !== "revoked") return { state: session.state, qr: null, error: "SESSION_RESET_NOT_ALLOWED" };
  try {
    const instances = providerInstances(await providerRequest("GET", "/instance/all"));
    const existingCredential = session.tokenCiphertext
      ? await decryptSecret(session.tokenCiphertext, `business:${session.businessId}:session-token`)
      : "";
    const remoteStillExists = instances.some((instance) =>
      (session.providerInstanceId !== undefined && instance.id === session.providerInstanceId) ||
      instance.name === session.instanceName ||
      (existingCredential !== "" && instance.token === existingCredential)
    );
    if (remoteStillExists) return { state: "revoked", qr: null, error: "PROVIDER_INSTANCE_STILL_EXISTS" };
    const token = randomToken();
    const tokenCiphertext = await encryptSecret(token, `business:${session.businessId}:session-token`);
    const tokenHash = await sha256(token);
    const reset = await ctx.runMutation(internal.foundation.resetRevokedSession, {
      sessionId: session._id,
      generation: session.generation,
      operationVersion: session.operationVersion ?? 0,
      tokenCiphertext,
      tokenHash,
    });
    if (!reset) return { state: "revoked", qr: null, error: "SESSION_RESET_CONFLICT" };
    logEvent("connection_reset", { correlationId: session._id, businessId: session.businessId, code: "REMOTE_INSTANCE_ABSENT" });
    return { state: "disconnected", qr: null, error: null };
  } catch (error) {
    return { state: "revoked", qr: null, error: connectionErrorCode(error) };
  }
}

export const connect = action({
  args: { businessId: v.id("businesses"), disclosureVersion: v.string(), acceptedRisk: v.boolean(), method: v.optional(pairingMethod), phoneNumber: v.optional(v.string()) }, returns: connectionResult,
  handler: async (ctx, args): Promise<ConnectionResult> => {
    const business = await ctx.runQuery(internal.foundation.ownedBusiness, { businessId: args.businessId });
    if (!args.acceptedRisk) throw new ConvexError({ code: "DISCLOSURE_REQUIRED" });
    const method = args.method ?? "qr";
    const phone = args.phoneNumber?.trim().replace(/[ ()-]/g, "") ?? "";
    if (method === "phone" && (!args.phoneNumber || args.phoneNumber.length > 32 || !/^\+[1-9][0-9]{6,14}$/.test(phone))) {
      return { state: "disconnected", qr: null, error: "INVALID_PAIRING_PHONE" };
    }
    if (process.env.FOUNDATION_PROVIDER_ENABLED !== "true" || process.env.FOUNDATION_PROVIDER_CONTRACT_VERIFIED !== "true") return { state: "disconnected", qr: null, error: "PROVIDER_QUALIFICATION_REQUIRED" };
    let tokenCiphertext: string;
    let tokenHash: string;
    try {
      const token = randomToken();
      tokenCiphertext = await encryptSecret(token, `business:${args.businessId}:session-token`);
      tokenHash = await sha256(token);
    } catch (error) {
      return { state: "disconnected", qr: null, error: connectionErrorCode(error) };
    }
    const prepared = await ctx.runMutation(internal.foundation.prepareSession, { businessId: args.businessId, disclosureVersion: args.disclosureVersion, tokenCiphertext, tokenHash, pairingMethod: method });
    const session = await ctx.runQuery(internal.foundation.sessionById, { sessionId: prepared.sessionId });
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (!prepared.claimed) return { state: session.state, qr: null, error: session.state === "connected" ? null : "CONNECTION_IN_PROGRESS" };
    try {
      const credential = await decryptSecret(session.tokenCiphertext, `business:${args.businessId}:session-token`);
      let instanceId = session.providerInstanceId;
      if (!instanceId) {
        const listing = await providerRequest("GET", "/instance/all");
        const displayName = providerDisplayName(business.name, business._id);
        const matches = providerInstances(listing).filter((instance) =>
          instance.name === session.instanceName || (instance.token !== "" && instance.token === credential)
        );
        if (matches.length > 1) throw new Error("PROVIDER_INSTANCE_UNRESOLVED");
        // Display-name equality is not proof that a remotely found instance is
        // ours. Adopt it only when its returned token matches our encrypted key.
        if (matches.length && matches[0].token !== credential) throw new Error("PROVIDER_INSTANCE_UNRESOLVED");
        instanceId = matches.length ? matches[0].id : "";
        if (!matches.length) {
          const permitted = await ctx.runMutation(internal.foundation.markCreateAttempt, { sessionId: session._id, generation: session.generation });
          if (!permitted) throw new Error("PROVIDER_INSTANCE_UNRESOLVED");
          // The dashboard-facing name is the business name the owner entered
          // during onboarding. Authentication and webhook routing continue to
          // use the separate random credential and provider UUID.
          const created = await providerRequest("POST", "/instance/create", { body: { name: displayName, token: credential } });
          instanceId = providerInstanceId(created);
        }
        if (!instanceId) throw new Error("PROVIDER_INSTANCE_UNRESOLVED");
        await ctx.runMutation(internal.foundation.updateSession, { sessionId: session._id, generation: session.generation, operationVersion: session.operationVersion ?? 0, providerInstanceId: instanceId, state: "pending" });
      }
      const siteUrl = process.env.CONVEX_SITE_URL;
      if (!siteUrl) throw new Error("PROVIDER_NOT_CONFIGURED");
      const current = await ctx.runQuery(internal.foundation.sessionById, { sessionId: session._id });
      if (!current || current.generation !== session.generation || current.operationVersion !== session.operationVersion || current.state === "revoked") return { state: "revoked", qr: null, error: "SESSION_REVOKED" };
      if (current.state === "connected") return await pairingResult(current);
      const credentials = { instanceId, token: credential };
      const operation = { sessionId: session._id, generation: session.generation, operationVersion: session.operationVersion ?? 0 };
      await providerRequest("POST", "/instance/connect", { ...credentials, body: { webhookUrl: `${siteUrl.replace(/\/$/, "")}/api/webhook/evolution`, subscribe: pairingSubscriptions, immediate: true } });
      if (method === "phone") {
        const providerState = providerConnectionState(await providerRequest("GET", "/instance/status", credentials));
        if (providerState !== "connected") {
          if (providerState === "disconnected") await new Promise((resolve) => setTimeout(resolve, 1500));
          const beforePair = await ctx.runQuery(internal.foundation.sessionById, { sessionId: session._id });
          if (!beforePair || beforePair.generation !== session.generation || beforePair.operationVersion !== session.operationVersion || beforePair.state === "revoked") return { state: "revoked", qr: null, error: "SESSION_REVOKED" };
          if (beforePair.state !== "connected") {
            const response = await providerRequest("POST", "/instance/pair", { ...credentials, body: { phone: phone.slice(1), subscribe: pairingSubscriptions } });
            const pairingCode = providerPairingCode(response);
            if (!pairingCode) throw new Error("PAIRING_CODE_UNAVAILABLE");
            const pairingCodeCiphertext = await encryptSecret(pairingCode, `session:${session._id}:pairing-code`);
            await ctx.runMutation(internal.foundation.updateSession, { ...operation, state: "pending", pairingCodeCiphertext, completeOperation: true });
            const started = await ctx.runQuery(internal.foundation.sessionById, { sessionId: session._id });
            return started ? await pairingResult(started) : { state: "revoked", qr: null, error: "SESSION_REVOKED" };
          }
        }
      }
      await ctx.runMutation(internal.foundation.updateSession, { ...operation, state: method === "phone" ? "connected" : "pending", completeOperation: true });
      // Ask for the first artifact immediately. QR generation can still be
      // transient, so checkHealth keeps the session pending and the UI polls.
      await ctx.runAction(internal.connections.checkHealth, { sessionId: session._id, generation: session.generation });
      const started = await ctx.runQuery(internal.foundation.sessionById, { sessionId: session._id });
      return started ? await pairingResult(started) : { state: "revoked", qr: null, error: "SESSION_REVOKED" };
    } catch (error) {
      const code = error instanceof Error && error.message === "PAIRING_CODE_UNAVAILABLE" ? error.message : connectionErrorCode(error);
      await ctx.runMutation(internal.foundation.updateSession, { sessionId: session._id, generation: session.generation, operationVersion: session.operationVersion ?? 0, state: "error", code, completeOperation: true });
      const latest = await ctx.runQuery(internal.foundation.sessionById, { sessionId: session._id });
      if (latest?.state === "connected" || latest?.state === "revoked") return await pairingResult(latest);
      logEvent("connection_failed", { correlationId: session._id, businessId: session.businessId, code });
      return { state: "error", qr: null, error: code };
    }
  },
});

export const resetRevoked = action({
  args: { businessId: v.id("businesses") }, returns: connectionResult,
  handler: async (ctx, args): Promise<ConnectionResult> => {
    const session = await ctx.runQuery(internal.foundation.ownedSession, { businessId: args.businessId });
    if (!session) return { state: "disconnected", qr: null, error: null };
    return await resetRevokedSession(ctx, session);
  },
});

export const resetRevokedForOperator = internalAction({
  args: { businessId: v.id("businesses") }, returns: connectionResult,
  handler: async (ctx, args): Promise<ConnectionResult> => {
    const session = await ctx.runQuery(internal.foundation.sessionByBusiness, { businessId: args.businessId });
    if (!session) return { state: "disconnected", qr: null, error: null };
    return await resetRevokedSession(ctx, session);
  },
});

export const refresh = action({
  args: { businessId: v.id("businesses") }, returns: connectionResult,
  handler: async (ctx, args): Promise<ConnectionResult> => {
    const owned = await ctx.runQuery(internal.foundation.ownedSession, { businessId: args.businessId });
    if (!owned) return { state: "disconnected", qr: null, error: null };
    if (owned.state !== "revoked" && owned.providerInstanceId) await ctx.runAction(internal.connections.checkHealth, { sessionId: owned._id, generation: owned.generation });
    const session = await ctx.runQuery(internal.foundation.ownedSession, { businessId: args.businessId });
    if (!session) return { state: "disconnected", qr: null, error: null };
    return await pairingResult(session);
  },
});

export const checkHealth = internalAction({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number() }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.runQuery(internal.foundation.sessionById, { sessionId: args.sessionId });
    if (!session || session.generation !== args.generation || session.state === "revoked" || !session.providerInstanceId || (session.operationLeaseUntil ?? 0) > Date.now()) return null;
    const operationVersion = session.operationVersion ?? 0;
    try {
      let token = await decryptSecret(session.tokenCiphertext, `business:${session.businessId}:session-token`);
      let status: unknown;
      try {
        status = await providerRequest("GET", "/instance/status", { token, instanceId: session.providerInstanceId });
      } catch (error) {
        if (providerErrorCode(error) !== "PROVIDER_AUTH_FAILED") throw error;
        const repairedToken = await repairProviderCredential(ctx, session, token);
        if (!repairedToken) throw error;
        token = repairedToken;
        status = await providerRequest("GET", "/instance/status", { token, instanceId: session.providerInstanceId });
      }
      const state = providerConnectionState(status);
      let qrCiphertext: string | undefined;
      if (session.pairingMethod !== "phone" && (state === "pending" || (state !== "connected" && session.state === "pending"))) {
        try {
          const result = object(await providerRequest("GET", "/instance/qr", { token, instanceId: session.providerInstanceId }));
          const qr = providerQr(result);
          if (qr) qrCiphertext = await encryptSecret(qr, `session:${session._id}:qr`);
        } catch (error) {
          // Evolution Go can return a transient non-2xx response while the QR
          // is being generated. Authentication/configuration failures are not
          // transient and must still surface immediately.
          const code = connectionErrorCode(error);
          if (code !== "PROVIDER_REQUEST_FAILED" && code !== "PROVIDER_UNAVAILABLE") throw error;
        }
      }
      const effectiveState = state === "connected" ? "connected" : session.state === "pending" || qrCiphertext ? "pending" : state;
      await ctx.runMutation(internal.foundation.updateSession, { sessionId: session._id, generation: session.generation, operationVersion, state: effectiveState, health: true, ...(qrCiphertext ? { qrCiphertext } : {}) });
      if (effectiveState === "connected") await ctx.scheduler.runAfter(0, internal.directorySync.sync, { sessionId: session._id, generation: session.generation });
      logEvent("connection_checked", { correlationId: session._id, businessId: session.businessId, code: state.toUpperCase() });
    } catch (error) {
      const code = connectionErrorCode(error);
      const transientPhoneCheck = session.state === "pending" && session.pairingMethod === "phone" && ["PROVIDER_REQUEST_FAILED", "PROVIDER_UNAVAILABLE"].includes(code);
      await ctx.runMutation(internal.foundation.updateSession, { sessionId: session._id, generation: session.generation, operationVersion, state: transientPhoneCheck ? "pending" : "error", code, health: true });
      logEvent("connection_failed", { correlationId: session._id, businessId: session.businessId, code });
    }
    return null;
  },
});

export const disconnectRevoked = internalAction({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number() }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.runMutation(internal.foundation.claimDisconnect, args);
    if (!session) return null;
    try {
      // An unresolved create may have succeeded remotely. Leave it visible for
      // operator reconciliation rather than falsely claiming it was disconnected.
      if (!session.providerInstanceId) throw new Error("PROVIDER_INSTANCE_UNRESOLVED");
      const token = await decryptSecret(session.tokenCiphertext, `business:${session.businessId}:session-token`);
      await providerRequest("POST", "/instance/disconnect", { token, instanceId: session.providerInstanceId });
      await ctx.runMutation(internal.foundation.completeDisconnect, args);
    } catch {
      await ctx.runMutation(internal.foundation.recordDisconnectFailure, { sessionId: args.sessionId, generation: args.generation, code: "PROVIDER_DISCONNECT_FAILED" });
    }
    return null;
  },
});
