import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { encryptSecret, identityDigest, secretMatches, sha256 } from "./lib/crypto";
import { normalizeEvent, readBoundedJson, semanticEventKey, text } from "./lib/events";
import { logEvent } from "./lib/policy";
import type { NormalizedEvent } from "./lib/validators";
import { businessAiOptions, streamBusinessSystemPrompt, transcribeBusinessDescription } from "./businessProfileHttp";
import { verifyPaystackSignature, paystackTimestamp, safeProviderString, type ProviderObject } from "./lib/paystack";
import { sha256 as digestSha256 } from "./lib/crypto";
import { receive as receiveMetaWebhook, verify as verifyMetaWebhook } from "./metaHttp";

// This is the only active HTTP router during the foundation phase.
const http = httpRouter();

http.route({ path: "/api/webhook/meta/whatsapp", method: "GET", handler: verifyMetaWebhook });
http.route({ path: "/api/webhook/meta/whatsapp", method: "POST", handler: receiveMetaWebhook });

http.route({
  path: "/api/webhook/evolution", method: "POST",
  handler: httpAction(async (ctx, request) => {
    const receivedAt = Date.now();
    const correlationId = crypto.randomUUID();
    const headers = { "Cache-Control": "no-store", "X-Correlation-ID": correlationId };
    try {
      const body = await readBoundedJson(request);
      const providerInstanceId = text(body.instanceId);
      const token = text(body.instanceToken, 1024);
      if (!providerInstanceId || !token) return Response.json({ error: "INVALID_WEBHOOK_AUTH" }, { status: 401, headers });
      const source = await ctx.runQuery(internal.foundation.sessionByProvider, { providerInstanceId, receivedAt });
      const session = source?.session;
      const tokenHash = await sha256(token);
      if (!session || session.provider === "meta" || session.state === "revoked" || !secretMatches(session.tokenHash, tokenHash)) return Response.json({ error: "INVALID_WEBHOOK_AUTH" }, { status: 401, headers });
      let payload: NormalizedEvent;
      let quarantineCode: string | undefined;
      try {
        payload = normalizeEvent(body, receivedAt, source.aiProcessingEpoch !== null);
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
      const accepted = await ctx.runMutation(internal.ingestion.enqueue, { sessionId: session._id, generation: session.generation, tokenHash, eventKey, correlationId, payload, receivedAt, observedAiEpoch: source.aiProcessingEpoch, ...(quarantineCode ? { quarantineCode } : {}) });
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
http.route({ path: "/api/health", method: "GET", handler: httpAction(async () => Response.json({ status: "ok", phase: 1, assistantRepliesAvailable: true, statusToCashEnabled: false })) });
http.route({ path: "/api/business-ai/transcribe", method: "POST", handler: transcribeBusinessDescription });
http.route({ path: "/api/business-ai/generate", method: "POST", handler: streamBusinessSystemPrompt });
http.route({ path: "/api/business-ai/transcribe", method: "OPTIONS", handler: businessAiOptions });
http.route({ path: "/api/business-ai/generate", method: "OPTIONS", handler: businessAiOptions });

http.route({
  path: "/api/webhook/paystack",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 256_000) return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 256_000) return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    const signature = request.headers.get("x-paystack-signature") ?? "";
    if (!(await verifyPaystackSignature(rawBody, signature))) return Response.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
    let payload: ProviderObject;
    try { payload = JSON.parse(rawBody) as ProviderObject; }
    catch { return Response.json({ error: "INVALID_JSON" }, { status: 400 }); }
    const eventType = safeProviderString(payload.event, 120);
    if (!eventType) return Response.json({ error: "INVALID_EVENT" }, { status: 400 });
    const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data as ProviderObject : {};
    const customer = data.customer && typeof data.customer === "object" && !Array.isArray(data.customer) ? data.customer as ProviderObject : {};
    const subscription = data.subscription && typeof data.subscription === "object" && !Array.isArray(data.subscription) ? data.subscription as ProviderObject : data;
    const plan = data.plan && typeof data.plan === "object" && !Array.isArray(data.plan) ? data.plan as ProviderObject : {};
    const eventDigest = await digestSha256(rawBody);
    const result = await ctx.runMutation(internal.billing.processWebhook, {
      eventDigest,
      eventType,
      ...(safeProviderString(data.reference, 120) ? { reference: safeProviderString(data.reference, 120) } : {}),
      ...(safeProviderString(data.status, 40) ? { status: safeProviderString(data.status, 40) } : {}),
      ...(typeof data.amount === "number" ? { amountKobo: data.amount } : {}),
      ...(safeProviderString(data.currency, 8) ? { currency: safeProviderString(data.currency, 8) } : {}),
      ...(data.id !== undefined ? { transactionId: String(data.id).slice(0, 120) } : {}),
      ...(safeProviderString(data.channel, 40) ? { channel: safeProviderString(data.channel, 40) } : {}),
      ...(paystackTimestamp(data.paid_at ?? data.paidAt) ? { paidAt: paystackTimestamp(data.paid_at ?? data.paidAt) } : {}),
      ...(safeProviderString(plan.plan_code ?? data.plan, 120) ? { providerPlanCode: safeProviderString(plan.plan_code ?? data.plan, 120) } : {}),
      ...(safeProviderString(customer.customer_code ?? customer.code, 120) ? { providerCustomerCode: safeProviderString(customer.customer_code ?? customer.code, 120) } : {}),
      ...(safeProviderString(subscription.subscription_code ?? data.subscription_code, 120) ? { providerSubscriptionCode: safeProviderString(subscription.subscription_code ?? data.subscription_code, 120) } : {}),
      ...(safeProviderString(subscription.email_token ?? data.email_token, 500) ? { providerEmailToken: safeProviderString(subscription.email_token ?? data.email_token, 500) } : {}),
      ...(paystackTimestamp(subscription.next_payment_date ?? data.next_payment_date) ? { nextPaymentAt: paystackTimestamp(subscription.next_payment_date ?? data.next_payment_date) } : {}),
    });
    return Response.json({ received: true, processed: result.processed }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }),
});

export default http;
