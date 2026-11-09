import { foundationPolicy } from "./policy";
import type { NormalizedEvent } from "./validators";

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function text(value: unknown, maximum = 256): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

export function normalizeIdentity(value: unknown): string {
  if (typeof value !== "string" || value.length > 256) throw new Error("INVALID_IDENTITY");
  const identity = text(value).replace(/^(\d+):\d+@s\.whatsapp\.net$/, "$1@s.whatsapp.net");
  if (identity === "status@broadcast" || /^\d+@(s\.whatsapp\.net|lid|g\.us)$/.test(identity)) return identity;
  throw new Error("INVALID_IDENTITY");
}

export function eventTime(value: unknown, now: number): number {
  const timestamp = typeof value === "number" ? (value < 100000000000 ? value * 1000 : value) : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > now + 300000) throw new Error("INVALID_TIMESTAMP");
  return timestamp;
}

export function normalizeEvent(body: Record<string, unknown>, now: number): NormalizedEvent {
  const event = text(body.event);
  const data = object(body.data);
  if (event === "Message" || event === "SendMessage") {
    const info = object(data.Info);
    const message = object(data.Message);
    const chat = normalizeIdentity(info.Chat);
    if (info.IsGroup === true || chat.endsWith("@g.us")) return { kind: "ignored", reason: "GROUP_DISABLED" };
    if (chat === "status@broadcast") return { kind: "ignored", reason: "STATUS_CONTENT_DEFERRED" };
    const messageId = text(info.ID);
    if (!messageId || (info.ID as string).length > 256 || typeof info.IsFromMe !== "boolean") throw new Error("INVALID_MESSAGE_METADATA");
    const plain = text(message.conversation, foundationPolicy().maxTextLength) || text(object(message.extendedTextMessage).text, foundationPolicy().maxTextLength);
    const type = plain ? "text" : message.imageMessage ? "image" : message.videoMessage ? "video" : message.audioMessage ? "audio" : message.documentMessage ? "document" : message.locationMessage ? "location" : "unsupported";
    const caption = text(object(message.imageMessage ?? message.videoMessage ?? message.documentMessage).caption, foundationPolicy().maxTextLength);
    return {
      kind: "message", messageId, chat, identityKey: "", fromMe: event === "SendMessage" || info.IsFromMe,
      ...(text(info.PushName, 120) ? { name: text(info.PushName, 120) } : {}),
      // Large text is minimized, with an explicit manual-review signal rather
      // than presenting a truncated message as complete buyer context.
      text: plain || caption, mediaType: type, eventAt: eventTime(info.Timestamp, now), manualReview: type !== "text" || plain.length === foundationPolicy().maxTextLength || caption.length === foundationPolicy().maxTextLength,
    };
  }
  if (event === "Receipt") {
    const chat = normalizeIdentity(data.Chat);
    if (chat.endsWith("@g.us")) return { kind: "ignored", reason: "GROUP_DISABLED" };
    const rawState = text(body.state || data.Type).toLowerCase().replaceAll("_", "");
    const state = rawState === "readself" ? "read_self" : rawState === "read" ? "read" : rawState === "delivered" ? "delivered" : null;
    if (!state || !Array.isArray(data.MessageIDs) || data.MessageIDs.length === 0 || data.MessageIDs.length > 100) throw new Error("INVALID_RECEIPT");
    if (data.MessageIDs.some((value) => typeof value !== "string" || !value || value.length > 256)) throw new Error("INVALID_RECEIPT");
    const messageIds = [...new Set(data.MessageIDs.map((value) => text(value)).filter(Boolean))].sort();
    if (messageIds.length === 0) throw new Error("INVALID_RECEIPT");
    return { kind: "receipt", chat, sender: normalizeIdentity(data.Sender), identityKey: "", messageIds, state, eventAt: eventTime(data.Timestamp, now) };
  }
  if (["QRCode", "Connected", "PairSuccess", "LoggedOut", "Disconnected", "OfflineSyncCompleted", "QRTimeout"].includes(event)) {
    const qr = event === "QRCode" ? text(data.qrcode, 180000) : "";
    if (event === "QRCode" && !qr) throw new Error("INVALID_QR_EVENT");
    return { kind: "connection", event, ...(data.Timestamp ? { eventAt: eventTime(data.Timestamp, now) } : {}), ...(qr ? { qrCiphertext: qr } : {}) };
  }
  return { kind: "ignored", reason: "UNSUPPORTED_EVENT" };
}

export function semanticEventKey(event: NormalizedEvent): string {
  if (event.kind === "message") return `message:${event.fromMe ? "owner" : "customer"}:${event.chat}:${event.messageId}`;
  if (event.kind === "receipt") return `receipt:${event.chat}:${event.sender}:${event.state}:${event.messageIds.join(",")}`;
  return JSON.stringify(event);
}

export async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  const maximum = foundationPolicy().maxWebhookBytes;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new Error("PAYLOAD_TOO_LARGE");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("INVALID_CONTENT_TYPE");
  if (!request.body) throw new Error("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new Error("PAYLOAD_TOO_LARGE"); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_JSON");
  return object(parsed);
}
