import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { encryptSecret, identityDigest, secretMatches, sha256 } from "./lib/crypto";
import { normalizeEvent, readBoundedJson, semanticEventKey, text } from "./lib/events";
import { logEvent } from "./lib/policy";
import type { NormalizedEvent } from "./lib/validators";

// This is the only active HTTP router during the foundation phase.
const http = httpRouter();

http.route({
  path: "/api/webhook/evolution", method: "POST",
  handler: httpAction(async (ctx, request) => {
    const correlationId = crypto.randomUUID();
    const headers = { "Cache-Control": "no-store", "X-Correlation-ID": correlationId };
    try {
      const body = await readBoundedJson(request);
      const providerInstanceId = text(body.instanceId);
      const token = text(body.instanceToken, 1024);
      if (!providerInstanceId || !token) return Response.json({ error: "INVALID_WEBHOOK_AUTH" }, { status: 401, headers });
      const session = await ctx.runQuery(internal.foundation.sessionByProvider, { providerInstanceId });
      const tokenHash = await sha256(token);
      if (!session || session.state === "revoked" || !secretMatches(session.tokenHash, tokenHash)) return Response.json({ error: "INVALID_WEBHOOK_AUTH" }, { status: 401, headers });
      let payload: NormalizedEvent;
      let quarantineCode: string | undefined;
      try {
        payload = normalizeEvent(body, Date.now());
      } catch (error) {
        const known = ["INVALID_IDENTITY", "INVALID_TIMESTAMP", "INVALID_MESSAGE_METADATA", "INVALID_RECEIPT", "INVALID_QR_EVENT"];
        if (!(error instanceof Error) || !known.includes(error.message)) throw error;
        quarantineCode = error.message;
        payload = { kind: "ignored", reason: quarantineCode };
      }
      // Invalid-but-authenticated events keep only a digest and safe error code.
      const eventKey = await sha256(quarantineCode ? JSON.stringify({ event: body.event, data: body.data, state: body.state }) : semanticEventKey(payload));
      if (payload.kind === "message") payload.identityKey = await identityDigest(session.businessId, payload.chat);
      if (payload.kind === "receipt") payload.identityKey = await identityDigest(session.businessId, payload.chat === "status@broadcast" ? payload.sender : payload.chat);
      if (payload.kind === "connection" && payload.qrCiphertext) payload.qrCiphertext = await encryptSecret(payload.qrCiphertext, `session:${session._id}:qr`);
      const accepted = await ctx.runMutation(internal.ingestion.enqueue, { sessionId: session._id, generation: session.generation, tokenHash, eventKey, correlationId, payload, ...(quarantineCode ? { quarantineCode } : {}) });
      logEvent(accepted.duplicate ? "webhook_duplicate" : "webhook_accepted", { correlationId: accepted.correlationId, businessId: session.businessId, eventId: accepted.eventId });
      return Response.json({ accepted: true, duplicate: accepted.duplicate, correlationId: accepted.correlationId }, { status: 202, headers: { ...headers, "X-Correlation-ID": accepted.correlationId } });
    } catch (error) {
      const code = error instanceof Error && ["PAYLOAD_TOO_LARGE", "INVALID_CONTENT_TYPE", "INVALID_JSON", "INVALID_IDENTITY", "INVALID_TIMESTAMP", "INVALID_MESSAGE_METADATA", "INVALID_RECEIPT", "INVALID_QR_EVENT"].includes(error.message) ? error.message : error instanceof SyntaxError ? "INVALID_JSON" : "INGESTION_UNAVAILABLE";
      logEvent("webhook_rejected", { correlationId, code });
      return Response.json({ error: code, correlationId }, { status: code === "PAYLOAD_TOO_LARGE" ? 413 : code === "INGESTION_UNAVAILABLE" ? 503 : 400, headers });
    }
  }),
});

http.route({ path: "/api/worker", method: "POST", handler: httpAction(async () => Response.json({ error: "LEGACY_WORKER_DISABLED" }, { status: 410 })) });
http.route({ path: "/api/health", method: "GET", handler: httpAction(async () => Response.json({ status: "ok", phase: 1, outboundEnabled: false })) });

export default http;
