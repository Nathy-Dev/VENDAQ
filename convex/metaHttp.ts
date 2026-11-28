import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { identityDigest, secretMatches } from "./lib/crypto";
import { object, readBoundedBytes, text } from "./lib/events";
import { metaAddress, metaId, metaMessageId, metaPhone, verifyMetaWebhook } from "./lib/meta";
import { foundationPolicy } from "./lib/policy";
import type { NormalizedEvent } from "./lib/validators";

type Message = Extract<NormalizedEvent, { kind: "message" }>;
type Event = { eventKey: string; payload: NormalizedEvent };
const webhookHeaders = { "Cache-Control": "no-store" };
const batchSize = 32;

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}

function timestamp(value: unknown, now: number) {
  const seconds = typeof value === "number" || (typeof value === "string" && /^\d{1,12}$/.test(value)) ? Number(value) : NaN;
  const milliseconds = seconds * 1000;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= now + 300_000 ? milliseconds : null;
}

function normalizeMessage(message: Record<string, unknown>, now: number, options: { fromMe: boolean; fallback?: string; name?: string; historical?: boolean }): Message | null {
  const chat = options.fromMe ? metaAddress(message.to, message.to_user_id) || options.fallback : metaAddress(message.from, message.from_user_id) || options.fallback;
  const eventAt = timestamp(message.timestamp, now);
  if (!chat || !eventAt || !metaMessageId(message.id) || message.group_id) return null;
  const kind = text(message.type, 30);
  if (["reaction", "system", "request_welcome"].includes(kind)) return null;
  const content = object(message[kind]);
  const mediaType = kind === "text" || kind === "audio" || kind === "image" || kind === "video" || kind === "document" || kind === "location" ? kind : "unsupported";
  const body = text(kind === "text" ? content.body : content.caption, foundationPolicy().maxTextLength).trim();
  const mediaId = !options.historical && !options.fromMe && (kind === "image" || kind === "audio") && metaId(content.id) ? content.id : null;
  return {
    kind: "message", messageId: message.id, chat, identityKey: "", fromMe: options.fromMe, isGroup: false, mentioned: false,
    text: body || `[${mediaType === "unsupported" ? "Open WhatsApp to view this message" : mediaType}]`, mediaType,
    manualReview: options.historical === true || (mediaType !== "text" && !mediaId) || (mediaType === "text" && !body), eventAt,
    ...(mediaId ? { mediaPayload: JSON.stringify({ id: mediaId }), mediaMimeType: text(content.mime_type, 120) } : {}),
    ...(options.name ? { name: options.name } : {}), ...(options.historical ? { historical: true } : {}),
  };
}

export const verify = httpAction(async (_ctx, request) => {
  const expected = process.env.META_WHATSAPP_VERIFY_TOKEN;
  const params = new URL(request.url).searchParams;
  const challenge = params.get("hub.challenge");
  if (!expected || params.get("hub.mode") !== "subscribe" || !challenge || !/^\d{1,64}$/.test(challenge) || !secretMatches(expected, params.get("hub.verify_token") ?? "")) return new Response(null, { status: 403, headers: webhookHeaders });
  return new Response(challenge, { headers: { ...webhookHeaders, "Content-Type": "text/plain" } });
});

export const receive = httpAction(async (ctx, request) => {
  const secret = process.env.META_WHATSAPP_APP_SECRET;
  if (!secret) return new Response(null, { status: 503, headers: webhookHeaders });
  const correlationId = crypto.randomUUID();
  const receivedAt = Date.now();
  let body: Record<string, unknown>;
  try {
    const bytes = await readBoundedBytes(request, 3 * 1024 * 1024);
    if (!await verifyMetaWebhook(bytes, request.headers.get("x-hub-signature-256"), secret)) return new Response(null, { status: 401, headers: webhookHeaders });
    body = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch (error) {
    return new Response(null, { status: error instanceof Error && error.message === "PAYLOAD_TOO_LARGE" ? 413 : 400, headers: webhookHeaders });
  }
  if (body.object !== "whatsapp_business_account") return new Response(null, { status: 200, headers: webhookHeaders });
  try {
    for (const entry of list(body.entry)) {
      for (const change of list(entry.changes)) {
        const value = object(change.value);
        const metadata = object(value.metadata);
        const phoneId = metadata.phone_number_id;
        if (change.field === "account_update") {
          const wabaId = object(value.waba_info).waba_id ?? entry.id;
          const at = timestamp(entry.time, receivedAt);
          if (metaId(wabaId) && at && ["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED", "ACCOUNT_DELETED"].includes(String(value.event))) await ctx.runMutation(internal.metaConnections.offboard, { wabaId, at, ...(metaId(phoneId) ? { phoneId } : {}) });
          continue;
        }
        if (!["messages", "smb_message_echoes", "history", "smb_app_state_sync"].includes(String(change.field)) || !metaId(entry.id) || !metaId(phoneId)) continue;
        const source = await ctx.runQuery(internal.metaConnections.source, { wabaId: entry.id, phoneId });
        if (!source) continue;
        const { sessionId, generation, tokenHash, businessId } = source;
        const events: Event[] = [];
        const identities = new Map<string, string>();
        async function identity(chat: string) {
          const existing = identities.get(chat);
          if (existing) return existing;
          const digest = await identityDigest(businessId, chat);
          identities.set(chat, digest);
          return digest;
        }
        async function flush() {
          if (events.length) await ctx.runMutation(internal.ingestion.enqueueMeta, { sessionId, generation, tokenHash, correlationId, receivedAt, events: events.splice(0) });
        }
        async function append(eventKey: string, payload: NormalizedEvent) {
          if (payload.kind === "message" || payload.kind === "metaContact") payload.identityKey = await identity(payload.chat);
          events.push({ eventKey, payload });
          if (events.length === batchSize) await flush();
        }
        if (change.field === "messages" || change.field === "smb_message_echoes") {
          const fromMe = change.field === "smb_message_echoes";
          const contacts = new Map(list(value.contacts).map((contact) => [metaAddress(contact.wa_id, contact.user_id), text(object(contact.profile).name, 120)]));
          for (const message of list(fromMe ? value.message_echoes : value.messages)) {
            const name = contacts.get(fromMe ? metaAddress(message.to, message.to_user_id) : metaAddress(message.from, message.from_user_id));
            const payload = normalizeMessage(message, receivedAt, { fromMe, name });
            if (payload) await append(`message:${payload.messageId}`, payload);
          }
          for (const status of list(value.statuses)) {
            const at = timestamp(status.timestamp, receivedAt);
            const state = status.status;
            if (!at || !metaMessageId(status.id) || (state !== "sent" && state !== "delivered" && state !== "read" && state !== "failed")) continue;
            const errorCode = list(status.errors)[0]?.code;
            await append(`status:${status.id}:${state}:${at}`, { kind: "metaStatus", messageId: status.id, at, status: state, dispatchRef: text(status.biz_opaque_callback_data, 200), ...(Number.isSafeInteger(errorCode) ? { errorCode: Number(errorCode) } : {}) });
          }
        } else if (change.field === "smb_app_state_sync") {
          for (const update of list(value.state_sync)) {
            const contact = object(update.contact);
            const chat = metaAddress(contact.phone_number, contact.user_id);
            const at = timestamp(object(update.metadata).timestamp, receivedAt);
            if (update.type !== "contact" || !chat || !at || (update.action !== "add" && update.action !== "remove")) continue;
            const name = text(contact.full_name ?? contact.first_name, 120).trim();
            await append(`contact:${await identity(chat)}:${at}:${update.action}`, { kind: "metaContact", chat, identityKey: "", name, eventAt: at, removed: update.action === "remove" });
          }
          await flush();
          await ctx.runMutation(internal.metaConnections.syncResult, { sessionId, generation, kind: "contacts", received: true });
        } else {
          let declined = list(value.errors).some((error) => Number(error.code) === 2593109);
          let progress: number | undefined;
          for (const chunk of list(value.history)) {
            const candidate = object(chunk.metadata).progress;
            if (typeof candidate === "number" && candidate >= 0 && candidate <= 100) progress = Math.max(progress ?? 0, candidate);
            declined ||= list(chunk.errors).some((error) => Number(error.code) === 2593109);
            for (const thread of list(chunk.threads)) {
              const fallback = metaAddress(thread.id, thread.user_id);
              if (!fallback || thread.group_id) continue;
              for (const message of list(thread.messages)) {
                const fromMe = !!message.to || !!message.to_user_id || (!!metaPhone(message.from) && metaPhone(message.from) === metaPhone(source.displayPhone));
                const payload = normalizeMessage(message, receivedAt, { fromMe, fallback, historical: true });
                if (payload) await append(`history:${payload.messageId}`, payload);
              }
            }
          }
          await flush();
          await ctx.runMutation(internal.metaConnections.syncResult, { sessionId, generation, kind: "history", received: true, ...(declined ? { declined } : {}), ...(progress !== undefined ? { progress } : {}) });
        }
        await flush();
      }
    }
    return new Response(null, { status: 200, headers: webhookHeaders });
  } catch {
    console.warn("meta_webhook_retry", { correlationId });
    return new Response(null, { status: 503, headers: { ...webhookHeaders, "X-Correlation-ID": correlationId } });
  }
});
