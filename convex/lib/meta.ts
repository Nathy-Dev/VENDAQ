import { secretMatches } from "./crypto";
import { object, text } from "./events";

export const META_DISCLOSURE = "meta-coexistence-v1";
export const META_ATTEMPT_MS = 10 * 60_000;
export const META_HEALTH_MS = 15 * 60_000;
export const META_SERVICE_WINDOW_MS = 24 * 60 * 60_000;

export function metaId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{4,29}$/.test(value);
}

export function metaPhone(value: unknown): string {
  const digits = typeof value === "string" ? value.replace(/[+ ()-]/g, "") : "";
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : "";
}

export function metaAddress(phone: unknown, userId?: unknown): string {
  const digits = metaPhone(phone);
  if (digits) return `${digits}@s.whatsapp.net`;
  return typeof userId === "string" && /^[A-Za-z0-9_.:-]{4,128}$/.test(userId) ? `${userId}@meta` : "";
}

export function metaRecipient(address: string): string | null {
  return /^([1-9]\d{6,14})@s\.whatsapp\.net$/.exec(address)?.[1] ?? null;
}

export function metaSignupConfig() {
  const appId = process.env.META_WHATSAPP_APP_ID;
  const configId = process.env.META_WHATSAPP_CONFIG_ID;
  const version = process.env.META_GRAPH_VERSION;
  return process.env.META_WHATSAPP_ENABLED === "true" && metaId(appId) && metaId(configId) && version && /^v\d{2,3}\.0$/.test(version) && process.env.META_WHATSAPP_APP_SECRET && process.env.META_WHATSAPP_VERIFY_TOKEN
    ? { appId, configId, version } : null;
}

export class MetaError extends Error {
  constructor(readonly code: string, readonly rejected = true) { super(code); }
}

async function hmac(secret: string, bytes: BufferSource): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyMetaWebhook(body: ArrayBuffer, signature: string | null, secret: string) {
  return !!signature && /^sha256=[a-f0-9]{64}$/.test(signature) && secretMatches(`sha256=${await hmac(secret, body)}`, signature);
}

type GraphOptions = { method?: "GET" | "POST"; token?: string; params?: Record<string, string>; body?: Record<string, unknown> };

export async function graph(path: string, options: GraphOptions = {}): Promise<Record<string, unknown>> {
  const version = process.env.META_GRAPH_VERSION;
  const secret = process.env.META_WHATSAPP_APP_SECRET;
  if (!version || !/^v\d{2,3}\.0$/.test(version) || !secret) throw new MetaError("META_NOT_CONFIGURED");
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, value);
  if (options.token) url.searchParams.set("appsecret_proof", await hmac(secret, new TextEncoder().encode(options.token)));
  let response: Response;
  let data: Record<string, unknown>;
  try {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 10_000);
    try {
      response = await fetch(url, {
        method: options.method ?? "GET", redirect: "error", signal: timeout.signal,
        headers: { Accept: "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.body ? { "Content-Type": "application/json" } : {}) },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
      data = object(await response.json());
    } finally { clearTimeout(timer); }
  } catch { throw new MetaError("META_GRAPH_UNCONFIRMED", false); }
  if (!response.ok || data.error) {
    const code = Number(object(data.error).code);
    if (response.status >= 500 || response.status === 408) throw new MetaError("META_GRAPH_UNCONFIRMED", false);
    if (response.status === 401 || [10, 190, 200, 294].includes(code)) throw new MetaError("META_AUTH_EXPIRED");
    if (code === 131047) throw new MetaError("META_SERVICE_WINDOW_CLOSED");
    if (response.status === 429 || [4, 130429, 131056, 80007].includes(code)) throw new MetaError("META_RATE_LIMITED");
    throw new MetaError("META_GRAPH_REJECTED");
  }
  return data;
}

export async function exchangeMetaCode(code: string): Promise<string> {
  const config = metaSignupConfig();
  if (!config) throw new MetaError("META_NOT_CONFIGURED");
  const data = await graph("oauth/access_token", { params: { client_id: config.appId, client_secret: process.env.META_WHATSAPP_APP_SECRET!, code } });
  if (typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 4096) throw new MetaError("META_INVALID_TOKEN");
  return data.access_token;
}

export async function verifyMetaNumber(token: string, wabaId: string, phoneId: string): Promise<string> {
  let after = "";
  let found = false;
  for (let page = 0; page < 20; page++) {
    const listing = await graph(`${wabaId}/phone_numbers`, { token, params: { fields: "id", limit: "100", ...(after ? { after } : {}) } });
    if (Array.isArray(listing.data) && listing.data.some((number) => object(number).id === phoneId)) { found = true; break; }
    const paging = object(listing.paging);
    const cursor = text(object(paging.cursors).after, 2048);
    if (!paging.next || !cursor || cursor === after) break;
    after = cursor;
  }
  if (!found) throw new MetaError("META_NUMBER_NOT_IN_ACCOUNT");
  const number = await graph(phoneId, { token, params: { fields: "id,is_on_biz_app,platform_type,display_phone_number" } });
  const digits = metaPhone(number.display_phone_number);
  if (number.id !== phoneId || number.is_on_biz_app !== true || number.platform_type !== "CLOUD_API" || !digits) throw new MetaError("META_COEXISTENCE_REQUIRED");
  return `+${digits}`;
}

export function metaMessageId(value: unknown): value is string {
  return typeof value === "string" && /^wamid\.[A-Za-z0-9_./+=-]{1,500}$/.test(value);
}

export async function sendMetaText(args: { token: string; phoneId: string; target: string; content: string; dispatchId: string }) {
  const to = metaRecipient(args.target);
  const body = args.content.trim();
  if (process.env.META_WHATSAPP_SEND_ENABLED !== "true") throw new MetaError("META_SEND_DISABLED");
  if (!metaId(args.phoneId) || !to || !body || body.length > 4096) throw new MetaError("META_INVALID_DESTINATION_OR_TEXT");
  const result = await graph(`${args.phoneId}/messages`, { method: "POST", token: args.token, body: {
    messaging_product: "whatsapp", recipient_type: "individual", to, type: "text",
    text: { body, preview_url: false }, biz_opaque_callback_data: args.dispatchId,
  } });
  const messageId = Array.isArray(result.messages) ? object(result.messages[0]).id : null;
  if (!metaMessageId(messageId)) throw new MetaError("META_SEND_UNCONFIRMED", false);
  return messageId;
}

export async function downloadMetaMedia(args: { token: string; phoneId: string; id: unknown; kind: "audio" | "image"; canProcess: () => Promise<boolean> }) {
  if (!metaId(args.id) || !metaId(args.phoneId) || !await args.canProcess()) throw new MetaError("META_MEDIA_NOT_AUTHORIZED");
  const metadata = await graph(args.id, { token: args.token, params: { phone_number_id: args.phoneId } });
  const maximum = args.kind === "image" ? 5 * 1024 * 1024 : 16 * 1024 * 1024;
  const allowed = args.kind === "image" ? ["image/jpeg", "image/png"] : ["audio/ogg", "audio/aac", "audio/mp4", "audio/mpeg", "audio/amr"];
  const mimetype = text(metadata.mime_type, 120).split(";")[0].trim().toLowerCase();
  const size = Number(metadata.file_size);
  if (metadata.id !== args.id || !allowed.includes(mimetype) || !Number.isSafeInteger(size) || size <= 0 || size > maximum || typeof metadata.url !== "string") throw new MetaError("META_INVALID_MEDIA");
  const url = new URL(metadata.url);
  if (url.protocol !== "https:" || url.hostname !== "lookaside.fbsbx.com" || url.port || url.username || url.password || !await args.canProcess()) throw new MetaError("META_MEDIA_NOT_AUTHORIZED");
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${args.token}` }, redirect: "error", signal: timeout.signal });
    if (!response.ok || !response.body) throw new MetaError("META_MEDIA_UNAVAILABLE");
    const reader = response.body.getReader();
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (offset + chunk.value.byteLength > size) { await reader.cancel(); throw new MetaError("META_INVALID_MEDIA"); }
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
    if (offset !== size) throw new MetaError("META_INVALID_MEDIA");
    return { bytes, mimetype };
  } finally { clearTimeout(timer); }
}
