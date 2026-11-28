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

function optionalIdentity(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 256) return "";
  try { return normalizeIdentity(value); } catch { return ""; }
}

function groupName(data: Record<string, unknown>): string {
  const group = object(data.groupData ?? data.GroupData);
  const nestedName = object(group.GroupName);
  return text(group.Name ?? group.name ?? group.Subject ?? group.subject ?? group.groupName ?? nestedName.Name ?? nestedName.name, 120);
}

function boundedMediaMessage(message: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "URL", "url", "directPath", "mediaKey", "mimetype", "mimeType",
    "fileEncSHA256", "fileEncSha256", "fileSHA256", "fileSha256",
    "fileLength", "mediaKeyTimestamp", "height", "width", "viewOnce",
  ];
  const output: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = message[key];
    if (typeof value === "string" && value.length <= 8_192) output[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "boolean") output[key] = value;
    else if (Array.isArray(value) && value.length <= 128 && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) output[key] = value;
  }
  return output;
}

export function eventTime(value: unknown, now: number): number {
  const timestamp = typeof value === "number" ? (value < 100000000000 ? value * 1000 : value) : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > now + 300000) throw new Error("INVALID_TIMESTAMP");
  return timestamp;
}

export function normalizeEvent(body: Record<string, unknown>, now: number, includeMediaPayload: boolean): NormalizedEvent {
  const event = text(body.event);
  const data = object(body.data);
  if (event === "Message" || event === "SendMessage") {
    const info = object(data.Info);
    const message = object(data.Message);
    const rawChat = normalizeIdentity(info.Chat);
    const isGroup = info.IsGroup === true || rawChat.endsWith("@g.us");
    const fromMe = event === "SendMessage" || info.IsFromMe === true;
    // WhatsApp privacy IDs (@lid) and phone JIDs can identify the same person.
    // Prefer the provider's phone-number alias for private inbound messages.
    // SendMessage events already carry the actual recipient in Info.Chat.
    const senderAlt = optionalIdentity(info.SenderAlt);
    const recipientAlt = optionalIdentity(info.RecipientAlt);
    const preferredPrivateAlias = fromMe ? recipientAlt : senderAlt;
    const chat = !isGroup && rawChat.endsWith("@lid") && preferredPrivateAlias.endsWith("@s.whatsapp.net")
      ? preferredPrivateAlias
      : rawChat;
    const aliasJids = isGroup ? [] : [...new Set([rawChat, preferredPrivateAlias].filter((jid) => jid && jid !== chat))];
    if (chat === "status@broadcast") return { kind: "ignored", reason: "STATUS_CONTENT_DEFERRED" };
    const messageId = text(info.ID);
    if (!messageId || (info.ID as string).length > 256 || typeof info.IsFromMe !== "boolean") throw new Error("INVALID_MESSAGE_METADATA");
    const plain = text(message.conversation, foundationPolicy().maxTextLength) || text(object(message.extendedTextMessage).text, foundationPolicy().maxTextLength);
    const type = plain ? "text" : message.imageMessage ? "image" : message.videoMessage ? "video" : message.audioMessage ? "audio" : message.documentMessage ? "document" : message.locationMessage ? "location" : "unsupported";
    const caption = text(object(message.imageMessage ?? message.videoMessage ?? message.documentMessage).caption, foundationPolicy().maxTextLength);
    const audio = object(message.audioMessage);
    const image = object(message.imageMessage);
    const mediaMessage = type === "audio" ? audio : type === "image" ? image : {};
    const boundedMedia = includeMediaPayload && !fromMe ? boundedMediaMessage(mediaMessage) : {};
    const mediaPayload = type === "audio"
      ? JSON.stringify({ audioMessage: boundedMedia })
      : type === "image"
        ? JSON.stringify({ imageMessage: boundedMedia })
        : "";
    const mediaMimeType = ["audio", "image"].includes(type) ? text(mediaMessage.mimetype ?? mediaMessage.mimeType, 120) : "";
    // Only trust an explicit provider signal that the connected account was
    // mentioned. A generic `mentionedJid` list could refer to somebody else.
    const mentioned = isGroup && (info.IsMention === true || info.IsBotMentioned === true || data.IsMentioned === true);
    const participantJid = isGroup ? optionalIdentity(info.SenderAlt) || optionalIdentity(info.Sender) : "";
    const participantName = isGroup ? text(info.PushName, 120) : "";
    return {
      kind: "message", messageId, chat, identityKey: "", fromMe, isGroup, mentioned,
      ...((isGroup ? groupName(data) : text(info.PushName, 120)) ? { name: isGroup ? groupName(data) : text(info.PushName, 120) } : {}),
      ...(participantJid ? { participantJid } : {}),
      ...(participantName ? { participantName } : {}),
      ...(aliasJids.length ? { aliasJids } : {}),
      ...(Object.keys(boundedMedia).length && mediaPayload.length <= 20_000 ? { mediaPayload } : {}),
      ...(mediaMimeType ? { mediaMimeType } : {}),
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
  const bytes = await readBoundedBytes(request, foundationPolicy().maxWebhookBytes);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_JSON");
  return object(parsed);
}

export async function readBoundedBytes(request: Request, maximum: number): Promise<ArrayBuffer> {
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
  return bytes.buffer;
}
