import { v, type Infer, ConvexError } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { connectionState } from "./lib/validators";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "./lib/crypto";
import { logEvent } from "./lib/policy";
import { object } from "./lib/events";
import { providerRequest, providerInstanceId, providerConnectionState, providerErrorCode, providerQr } from "./lib/evolution";

const connectionResult = v.object({ state: connectionState, qr: v.union(v.string(), v.null()), error: v.union(v.string(), v.null()) });
type ConnectionResult = Infer<typeof connectionResult>;

export const connect = action({
  args: { businessId: v.id("businesses"), disclosureVersion: v.string(), acceptedRisk: v.boolean() }, returns: connectionResult,
  handler: async (ctx, args): Promise<ConnectionResult> => {
    await ctx.runQuery(internal.foundation.ownedSession, { businessId: args.businessId });
    if (!args.acceptedRisk) throw new ConvexError({ code: "DISCLOSURE_REQUIRED" });
    if (process.env.FOUNDATION_PROVIDER_ENABLED !== "true" || process.env.FOUNDATION_PROVIDER_CONTRACT_VERIFIED !== "true") return { state: "disconnected", qr: null, error: "PROVIDER_QUALIFICATION_REQUIRED" };
    const token = randomToken();
    const tokenCiphertext = await encryptSecret(token, `business:${args.businessId}:session-token`);
    const prepared = await ctx.runMutation(internal.foundation.prepareSession, { businessId: args.businessId, disclosureVersion: args.disclosureVersion, tokenCiphertext, tokenHash: await sha256(token) });
    const session = await ctx.runQuery(internal.foundation.sessionById, { sessionId: prepared.sessionId });
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (!prepared.claimed) return { state: session.state, qr: null, error: session.state === "connected" ? null : "CONNECTION_IN_PROGRESS" };
    try {
      const credential = await decryptSecret(session.tokenCiphertext, `business:${args.businessId}:session-token`);
      let instanceId = session.providerInstanceId;
      if (!instanceId) {
        const listing = await providerRequest("GET", "/instance/all");
        const root = object(listing);
        const candidates = Array.isArray(listing) ? listing : Array.isArray(root.data) ? root.data : Array.isArray(root.instances) ? root.instances : null;
        if (!candidates) throw new Error("PROVIDER_INSTANCE_UNRESOLVED");
        const matches = candidates.map(object).filter((instance) => instance.name === session.instanceName);
        if (matches.length > 1) throw new Error("PROVIDER_INSTANCE_UNRESOLVED");
        // Display-name equality is not proof that a remotely found instance is
        // ours. Adopt it only when its returned token matches our encrypted key.
        if (matches.length && matches[0].token !== credential) throw new Error("PROVIDER_INSTANCE_UNRESOLVED");
        instanceId = matches.length ? providerInstanceId(matches[0]) : "";
        if (!matches.length) {
          const permitted = await ctx.runMutation(internal.foundation.markCreateAttempt, { sessionId: session._id, generation: session.generation });
          if (!permitted) throw new Error("PROVIDER_INSTANCE_UNRESOLVED");
          const created = await providerRequest("POST", "/instance/create", { body: { name: session.instanceName, token: credential } });
          instanceId = providerInstanceId(created);
        }
        if (!instanceId) throw new Error("PROVIDER_INSTANCE_UNRESOLVED");
        await ctx.runMutation(internal.foundation.updateSession, { sessionId: session._id, generation: session.generation, operationVersion: session.operationVersion ?? 0, providerInstanceId: instanceId, state: "pending" });
      }
      const siteUrl = process.env.CONVEX_SITE_URL;
      if (!siteUrl) throw new Error("PROVIDER_NOT_CONFIGURED");
      const current = await ctx.runQuery(internal.foundation.sessionById, { sessionId: session._id });
      if (!current || current.generation !== session.generation || current.operationVersion !== session.operationVersion || current.state === "revoked") return { state: "revoked", qr: null, error: "SESSION_REVOKED" };
      await providerRequest("POST", "/instance/connect", { instanceId, token: credential, body: { webhookUrl: `${siteUrl.replace(/\/$/, "")}/api/webhook/evolution`, subscribe: ["MESSAGE", "SEND_MESSAGE", "READ_RECEIPT", "CONNECTION", "QRCODE"], immediate: true } });
      await ctx.runMutation(internal.foundation.updateSession, { sessionId: session._id, generation: session.generation, operationVersion: session.operationVersion ?? 0, state: "pending", completeOperation: true });
      return { state: "pending", qr: null, error: null };
    } catch (error) {
      const code = providerErrorCode(error);
      await ctx.runMutation(internal.foundation.updateSession, { sessionId: session._id, generation: session.generation, operationVersion: session.operationVersion ?? 0, state: "error", code, completeOperation: true });
      logEvent("connection_failed", { correlationId: session._id, businessId: session.businessId, code });
      return { state: "error", qr: null, error: code };
    }
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
    let qr: string | null = null;
    try {
      qr = session.qrCiphertext && (session.qrExpiresAt ?? 0) > Date.now() ? await decryptSecret(session.qrCiphertext, `session:${session._id}:qr`) : null;
    } catch { return { state: session.state, qr: null, error: "QR_DECRYPTION_UNAVAILABLE" }; }
    return { state: session.state, qr, error: session.lastError ?? null };
  },
});

export const checkHealth = internalAction({
  args: { sessionId: v.id("whatsappSessions"), generation: v.number() }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.runQuery(internal.foundation.sessionById, { sessionId: args.sessionId });
    if (!session || session.generation !== args.generation || session.state === "revoked" || !session.providerInstanceId) return null;
    try {
      const token = await decryptSecret(session.tokenCiphertext, `business:${session.businessId}:session-token`);
      const status = await providerRequest("GET", "/instance/status", { token, instanceId: session.providerInstanceId });
      const state = providerConnectionState(status);
      let qrCiphertext: string | undefined;
      if (state === "pending" || (state !== "connected" && session.state === "pending")) {
        const result = object(await providerRequest("GET", "/instance/qr", { token, instanceId: session.providerInstanceId }));
        const qr = providerQr(result);
        if (qr) qrCiphertext = await encryptSecret(qr, `session:${session._id}:qr`);
      }
      await ctx.runMutation(internal.foundation.updateSession, { sessionId: session._id, generation: session.generation, state: qrCiphertext ? "pending" : state, health: true, ...(qrCiphertext ? { qrCiphertext } : {}) });
      logEvent("connection_checked", { correlationId: session._id, businessId: session.businessId, code: state.toUpperCase() });
    } catch (error) {
      const code = providerErrorCode(error);
      await ctx.runMutation(internal.foundation.updateSession, { sessionId: session._id, generation: session.generation, state: "error", code, health: true });
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
