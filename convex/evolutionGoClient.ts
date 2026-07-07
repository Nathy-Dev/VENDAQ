/**
 * Evolution Go REST client.
 * All outbound WhatsApp messages go through sendText(), which enforces
 * the PRD-required 3-12 second randomized delay before every send.
 *
 * Required Convex environment variables:
 *   EVOLUTION_GO_URL          - e.g. https://your-vps.hostinger.com:8080
 *   EVOLUTION_GO_API_KEY      - global API key from Evolution Go config
 *   EVOLUTION_GO_INSTANCE_TOKEN - optional per-instance token override
 *   CONVEX_SITE_URL           - public Convex site URL (preferred)
 *   NEXT_PUBLIC_CONVEX_SITE_URL - fallback for local/dev setups
 */

type ConnectionArtifacts = {
  qrCode: string | null;
  pairingCode: string | null;
};

type InstanceStatus = {
  connected: boolean;
  loggedIn: boolean;
  name: string;
  /** Normalized state string: "open" | "close" | "connecting" */
  state: string;
};

type ProxySettings = {
  address: string;
  password: string;
  port: string;
  username: string;
};

type CreateInstanceOptions = {
  displayName?: string;
  instanceId?: string;
  token?: string;
  proxy?: Partial<ProxySettings>;
};

type ConnectInstanceOptions = {
  immediate?: boolean;
  phone?: string;
  subscribe?: string[];
  token?: string;
  webhookUrl?: string;
};

const DEFAULT_SUBSCRIBED_EVENTS = [
  "MESSAGE",
  "SEND_MESSAGE",
  "READ_RECEIPT",
  "PRESENCE",
  "HISTORY_SYNC",
  "CHAT_PRESENCE",
  "CALL",
  "CONNECTION",
  "LABEL",
  "CONTACT",
  "GROUP",
  "NEWSLETTER",
  "QRCODE",
  "BUTTON_CLICK",
];

function isEvolutionGoDebugEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.EVOLUTION_GO_DEBUG || "").toLowerCase());
}

function logEvolutionGoDebug(message: string, data?: unknown): void {
  if (!isEvolutionGoDebugEnabled()) return;
  if (typeof data === "undefined") {
    console.log(`[EvolutionGo debug] ${message}`);
    return;
  }
  console.log(`[EvolutionGo debug] ${message}`, data);
}

/**
 * Parses connection artifacts (QR code + pairing code) from any of the
 * response shapes Evolution Go may return. Now handles the documented
 * Pascal-cased fields: `Qrcode`, `Code`.
 */
function parseConnectionArtifacts(rawData: unknown): ConnectionArtifacts {
  const candidates = [
    rawData,
    (rawData as any)?.data,
    (rawData as any)?.result,
    (rawData as any)?.response,
    (rawData as any)?.instance,
    (rawData as any)?.data?.data,
    (rawData as any)?.data?.result,
    (rawData as any)?.data?.response,
    (rawData as any)?.data?.instance,
  ];

  for (const candidate of candidates) {
    const data = candidate as Record<string, any> | null | undefined;
    if (!data || typeof data !== "object") continue;

    // --- QR Code ---
    // Evolution Go documented shape:  { Qrcode: "data:image/png;base64,...", Code: "2@..." }
    // Also handle lowercase / nested variants for backwards compat.
    const qr = data.qrcode || data.qr || data.qrCode || data.Qrcode;
    const instance = data.instance;

    const qrCode =
      // Pascal-cased documented fields first
      data.Qrcode ||
      // Nested object variants
      qr?.base64 ||
      qr?.code ||
      qr?.Qrcode ||
      // Flat field variants
      data.base64 ||
      data.code ||
      // Nested instance variants
      instance?.qrcode?.base64 ||
      instance?.qrcode?.code ||
      instance?.qrcode ||
      instance?.Qrcode ||
      null;

    const pairingCode =
      data.pairingCode ||
      data.pairing_code ||
      data.pairCode ||
      data.PairingCode ||
      qr?.pairingCode ||
      qr?.pairing_code ||
      instance?.pairingCode ||
      instance?.pairing_code ||
      instance?.pairCode ||
      null;

    if (typeof qrCode === "string" || typeof pairingCode === "string") {
      return {
        qrCode: typeof qrCode === "string" ? qrCode : null,
        pairingCode: typeof pairingCode === "string" ? pairingCode : null,
      };
    }
  }

  return { qrCode: null, pairingCode: null };
}

function extractMatchingInstance(rawData: unknown, instanceName: string): Record<string, any> | null {
  const candidates: any[] = [];
  const data = rawData as any;

  if (Array.isArray(data)) {
    candidates.push(...data);
  } else if (data && typeof data === "object") {
    if (Array.isArray(data.instances)) {
      candidates.push(...data.instances);
    } else if (Array.isArray(data.data)) {
      candidates.push(...data.data);
    } else {
      candidates.push(...Object.values(data));
    }
  }

  return candidates.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const flatId = candidate.id || candidate.instanceId || candidate.instance_id;
    const flatName = candidate.instanceName || candidate.instance_name || candidate.name;
    const nestedId = candidate.instance?.id || candidate.instance?.instanceId || candidate.instance?.instance_id;
    const nestedName = candidate.instance?.instanceName || candidate.instance?.instance_name || candidate.instance?.name;
    return flatId === instanceName || flatName === instanceName || nestedId === instanceName || nestedName === instanceName;
  }) || null;
}

export function getEvolutionConfig(): { url: string; apiKey: string } {
  const url = process.env.EVOLUTION_GO_URL || "";
  const apiKey = process.env.EVOLUTION_GO_API_KEY || "";
  if (!url || !apiKey) {
    throw new Error(
      "EVOLUTION_GO_URL and EVOLUTION_GO_API_KEY must be set in Convex environment variables."
    );
  }
  return { url: url.replace(/\/$/, ""), apiKey };
}

export function getEvolutionWebhookUrl(): string | null {
  const siteUrl =
    process.env.CONVEX_SITE_URL ||
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
    "";

  if (!siteUrl) {
    return null;
  }

  return `${siteUrl.replace(/\/$/, "")}/api/webhook/evolution`;
}

function normalizeProxySettings(proxy?: Partial<ProxySettings>): Partial<ProxySettings> | undefined {
  if (!proxy) return undefined;

  const normalized = Object.fromEntries(
    Object.entries(proxy).filter(([, value]) => typeof value === "string" && value.trim() !== "")
  ) as Partial<ProxySettings>;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function generateEvolutionInstanceId(): string {
  const globalCrypto = globalThis.crypto as Crypto | undefined;
  if (globalCrypto?.randomUUID) {
    return globalCrypto.randomUUID();
  }

  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}


/**
 * Builds the payload for POST /instance/create.
 * Documented body: { name, token, proxy? }
 */
function buildCreateInstancePayload(instanceName: string, options?: CreateInstanceOptions): Record<string, unknown> {
  const proxy = normalizeProxySettings(options?.proxy);

  return {
    name: options?.displayName || instanceName,
    token: options?.token || instanceName,
    ...(proxy ? { proxy } : {}),
  };
}

/**
 * Builds the payload for POST /instance/connect.
 * Documented body: { immediate, phone, subscribe, webhookUrl }
 */
function buildConnectPayload(_instanceName: string, options?: ConnectInstanceOptions): Record<string, unknown> {
  return {
    immediate: options?.immediate ?? true,
    phone: options?.phone || "",
    subscribe: options?.subscribe || DEFAULT_SUBSCRIBED_EVENTS,
    webhookUrl: options?.webhookUrl || getEvolutionWebhookUrl() || "",
  };
}

/**
 * Builds the payload for POST /instance/pair.
 * Documented body: { phone, subscribe }
 */
function buildPairPayload(_instanceName: string, phone: string, options?: { subscribe?: string[] }): Record<string, unknown> {
  return {
    phone,
    subscribe: options?.subscribe || DEFAULT_SUBSCRIBED_EVENTS,
  };
}

export async function evoFetch(path: string, method: string, body?: unknown, customToken?: string): Promise<unknown> {
  const { url, apiKey } = getEvolutionConfig();
  logEvolutionGoDebug(`request ${method} ${path}`, body);
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: customToken || apiKey,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    logEvolutionGoDebug(`response ${method} ${path} -> ${res.status}`, text);
    throw new Error(`Evolution Go ${method} ${path} -> ${res.status}: ${text}`);
  }
  const data = await res.json();
  logEvolutionGoDebug(`response ${method} ${path} -> ${res.status}`, data);
  return data;
}

/**
 * Returns true if the named instance already exists on Evolution Go.
 *
 * Primary check: hit the token-authenticated /instance/status endpoint.
 * This is more reliable than listing all instances because the instance's
 * *display name* (set during createInstance) may differ from the token we
 * store as `evolutionInstanceName`.  For example, the display name might
 * be "My Business" while the token is "mybiz-abc12345" — the list-based
 * lookup would fail to match, but the status endpoint authenticates by
 * token and works regardless of display name.
 *
 * Fallback: if the status endpoint throws (e.g. the instance is in a
 * transitional state), we try the list-based lookup as a last resort.
 */
export async function instanceExists(instanceName: string): Promise<boolean> {
  // 1. Token-authenticated status check (most reliable)
  try {
    await evoFetch("/instance/status", "GET", undefined, instanceName);
    return true;
  } catch (_statusErr) {
    // Status endpoint failed — could mean the instance doesn't exist,
    // OR it could be in a transitional state. Try list as fallback.
  }

  // 2. Fallback: list all instances and match by name/id
  try {
    const rawData: any = await evoFetch("/instance/all", "GET");
    const exists = !!extractMatchingInstance(rawData, instanceName);
    if (!exists) {
      console.warn(`[instanceExists] Instance ${instanceName} not found via status or list.`);
    }
    return exists;
  } catch (error) {
    console.error("[instanceExists] Error:", error);
    return false;
  }
}

/** Fetches the matching instance record from /instance/all if present. */
export async function getInstanceRecord(instanceName: string): Promise<Record<string, any> | null> {
  try {
    const rawData: any = await evoFetch("/instance/all", "GET");
    return extractMatchingInstance(rawData, instanceName);
  } catch (error) {
    console.error("[getInstanceRecord] Error:", error);
    return null;
  }
}

/** Deletes an instance, ignoring errors (e.g. if it doesn't exist). */
export async function deleteInstanceSilently(instanceId: string): Promise<void> {
  try {
    await evoFetch(`/instance/delete/${encodeURIComponent(instanceId)}`, "DELETE");
  } catch {
    // ignore
  }
}

/** Creates a new WhatsApp instance on Evolution Go and returns any immediate connection artifacts. */
export async function createInstance(instanceName: string, options?: CreateInstanceOptions): Promise<ConnectionArtifacts> {
  const res = await evoFetch("/instance/create", "POST", buildCreateInstancePayload(instanceName, options)) as any;
  return parseConnectionArtifacts(res);
}

/** Starts the connection flow for an instance. Returns the raw response for inspection. */
export async function connectInstance(instanceName: string, options?: ConnectInstanceOptions): Promise<unknown> {
  const token = options?.token || instanceName;
  return await evoFetch("/instance/connect", "POST", buildConnectPayload(instanceName, options), token);
}

/** Requests a phone-based pairing code for an instance. */
export async function pairInstance(instanceName: string, phone: string, options?: { subscribe?: string[]; token?: string }): Promise<ConnectionArtifacts> {
  const token = options?.token || instanceName;
  const data = await evoFetch("/instance/pair", "POST", buildPairPayload(instanceName, phone, options), token);
  console.log(`[pairInstance raw data]`, JSON.stringify(data));
  return parseConnectionArtifacts(data);
}

/** Disconnects from an instance (keeps the instance, just drops the WS connection). */
export async function disconnectInstance(instanceName: string, instanceToken?: string): Promise<void> {
  const token = instanceToken || instanceName;
  await evoFetch("/instance/disconnect", "POST", undefined, token);
}

/** Logs out from an instance (clears session/auth, next connect will need new QR). */
export async function logoutInstance(instanceName: string, instanceToken?: string): Promise<void> {
  const token = instanceToken || instanceName;
  await evoFetch("/instance/logout", "DELETE", undefined, token);
}

/**
 * Configures webhook delivery for the instance by calling the connect endpoint
 * with the supplied webhook URL.
 */
export async function setWebhook(instanceName: string, webhookUrl: string): Promise<void> {
  await connectInstance(instanceName, { webhookUrl });
}

/**
 * Returns the current connection artifacts (QR image + raw code) for an instance.
 *
 * Evolution Go GET /instance/qr response:
 * { "data": { "Qrcode": "data:image/png;base64,...", "Code": "2@..." }, "message": "success" }
 */
export async function getConnectionArtifacts(instanceName: string): Promise<ConnectionArtifacts> {
  try {
    const data = await evoFetch("/instance/qr", "GET", undefined, instanceName);
    console.log(`[getConnectionArtifacts raw data]`, JSON.stringify(data));
    const artifacts = parseConnectionArtifacts(data);
    if (artifacts.qrCode || artifacts.pairingCode) {
      return artifacts;
    }
  } catch (e) {
    console.warn(`[getConnectionArtifacts] error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { qrCode: null, pairingCode: null };
}

/** Polls Evolution Go for a QR or pairing code for a short window after create. */
export async function waitForConnectionArtifacts(
  instanceName: string,
  options?: { attempts?: number; delayMs?: number }
): Promise<ConnectionArtifacts> {
  const attempts = options?.attempts ?? 10;
  const delayMs = options?.delayMs ?? 1500;

  for (let i = 0; i < attempts; i++) {
    const artifacts = await getConnectionArtifacts(instanceName);
    if (artifacts.qrCode || artifacts.pairingCode) {
      return artifacts;
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { qrCode: null, pairingCode: null };
}

/** Backwards-compatible helper used by older call sites. */
export async function getQR(instanceName: string): Promise<string | null> {
  const { qrCode } = await getConnectionArtifacts(instanceName);
  return qrCode;
}

/**
 * Returns the full instance status from Evolution Go.
 *
 * GET /instance/status response:
 * { "data": { "Connected": true, "LoggedIn": false, "Name": "" }, "message": "success" }
 *
 * IMPORTANT: `Connected: true` only means the WebSocket to WhatsApp servers is
 * open. It does NOT mean the user has scanned the QR code. `LoggedIn: true` is
 * the signal that the WhatsApp session is actually authenticated. We must
 * require BOTH for the `connected` flag to be true; otherwise the onboarding
 * UI will redirect to the dashboard before the QR code is scanned.
 */
export async function getInstanceStatus(instanceName: string): Promise<InstanceStatus> {
  const raw: any = await evoFetch("/instance/status", "GET", undefined, instanceName);

  // Try documented shape first: { data: { Connected, LoggedIn, Name } }
  const d = raw?.data ?? raw;

  // Whether the WebSocket to WhatsApp servers is open (does NOT imply auth)
  const wsOpen =
    d?.Connected === true ||
    d?.connected === true ||
    d?.state === "open" ||
    false;

  // Whether the WhatsApp session is authenticated (QR scanned / pairing accepted)
  const loggedIn =
    d?.LoggedIn === true ||
    d?.loggedIn === true ||
    d?.logged_in === true ||
    false;

  // Truly "connected" requires BOTH an open WS AND an authenticated session.
  // Without this, the WS opening (before QR scan) would be reported as
  // connected, causing a premature redirect in the onboarding UI.
  const connected = wsOpen && loggedIn;

  const name = d?.Name || d?.name || "";

  let state: string;
  if (connected) {
    state = "open";
  } else if (wsOpen || d?.state === "connecting" || d?.status === "connecting") {
    // WS is open but not authenticated, or actively connecting
    state = "connecting";
  } else {
    state = "close";
  }

  return { connected, loggedIn, name, state };
}

/** Returns the connection state: "open" | "close" | "connecting" */
export async function getConnectionState(instanceName: string): Promise<string> {
  try {
    const status = await getInstanceStatus(instanceName);
    return status.state;
  } catch (e) {
    console.warn(`[getConnectionState] error for ${instanceName}:`, e instanceof Error ? e.message : String(e));
    return "close";
  }
}

/**
 * Sends a text message.
 * Enforces a 3-12 second random delay before the actual send (PRD requirement).
 */
export async function sendText(instanceName: string, to: string, text: string): Promise<void> {
  const delayMs = 3000 + Math.random() * 9000;
  await new Promise((r) => setTimeout(r, delayMs));
  await evoFetch("/send/text", "POST", {
    number: to,
    text,
  }, instanceName);
}

/** Deletes an instance from Evolution Go. */
export async function deleteInstance(instanceId: string, instanceToken?: string): Promise<void> {
  await evoFetch(`/instance/delete/${encodeURIComponent(instanceId)}`, "DELETE", undefined, instanceToken);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA & MESSAGING FEATURES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Downloads media from a WhatsApp message via Evolution Go.
 * POST /message/downloadimage
 *
 * When a customer sends an image, the webhook provides metadata
 * (directPath, mediaKey, fileEncSHA256, etc.) but the actual media URL
 * is encrypted/temporary. This endpoint decrypts and returns the media
 * as base64.
 *
 * @returns Base64-encoded media data (without data URI prefix) and mimetype
 */
export async function downloadMedia(
  instanceName: string,
  messageData: {
    key: { remoteJid: string; id: string; fromMe?: boolean };
    message: Record<string, unknown>;
  }
): Promise<{ base64: string; mimetype: string }> {
  const { url } = getEvolutionConfig();

  logEvolutionGoDebug("downloadMedia request", messageData);

  const res = await fetch(`${url}/message/downloadimage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: instanceName,
    },
    body: JSON.stringify(messageData),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Evolution Go downloadMedia -> ${res.status}: ${text}`);
  }

  // Evolution Go may return JSON with base64, or raw binary
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = (await res.json()) as any;
    const result = data?.data || data;

    let base64: string = result?.base64 || result?.media || result?.data || "";
    const mimetype: string =
      result?.mimetype || result?.mimeType || result?.mediatype || "application/octet-stream";

    // Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
    if (base64.includes(",")) {
      base64 = base64.split(",")[1];
    }

    if (!base64) {
      throw new Error("No media data in Evolution Go download response (JSON)");
    }

    logEvolutionGoDebug("downloadMedia success", { mimetype, base64Length: base64.length });
    return { base64, mimetype };
  }

  // Binary response — convert ArrayBuffer to base64
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.length === 0) {
    throw new Error("No media data in Evolution Go download response (binary)");
  }

  // Chunk-safe ArrayBuffer → base64
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    parts.push(String.fromCharCode(...chunk));
  }
  const base64 = btoa(parts.join(""));
  const mimetype = contentType.split(";")[0].trim() || "application/octet-stream";

  logEvolutionGoDebug("downloadMedia success (binary)", { mimetype, bytes: bytes.length });
  return { base64, mimetype };
}

/**
 * Sends a media message (image, document, video, audio).
 * POST /send/media
 *
 * Enforces the same 3-12 second randomized delay as sendText (PRD requirement).
 */
export async function sendMedia(
  instanceName: string,
  to: string,
  options: {
    mediatype: "image" | "video" | "audio" | "document";
    media: string; // URL or base64 data URI
    mimetype: string;
    caption?: string;
    fileName?: string;
  }
): Promise<void> {
  const delayMs = 3000 + Math.random() * 9000;
  await new Promise((r) => setTimeout(r, delayMs));

  await evoFetch(
    "/send/media",
    "POST",
    {
      number: to,
      mediatype: options.mediatype,
      media: options.media,
      mimetype: options.mimetype,
      caption: options.caption || "",
      fileName: options.fileName || "",
    },
    instanceName
  );
}

/**
 * Marks messages as read (shows blue ticks to the sender).
 * POST /message/markread
 *
 * Non-critical — failures are logged but do not throw.
 */
export async function markAsRead(
  instanceName: string,
  messages: Array<{ remoteJid: string; fromMe: boolean; id: string }>
): Promise<void> {
  try {
    await evoFetch(
      "/message/markread",
      "POST",
      { readMessages: messages },
      instanceName
    );
  } catch (e) {
    console.warn("[markAsRead] Failed (non-critical):", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Sets chat presence (typing / recording indicator).
 * POST /message/presence
 *
 * Use "composing" before an AI reply, then let WhatsApp clear it
 * automatically when the message is sent.
 *
 * Non-critical — failures are logged but do not throw.
 */
export async function setChatPresence(
  instanceName: string,
  to: string,
  presence: "composing" | "paused" | "available" | "recording"
): Promise<void> {
  try {
    await evoFetch(
      "/message/presence",
      "POST",
      { number: to, presence },
      instanceName
    );
  } catch (e) {
    console.warn("[setChatPresence] Failed (non-critical):", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Reacts to a message with an emoji.
 * POST /message/react
 *
 * Pass an empty string as reaction to remove an existing reaction.
 *
 * Non-critical — failures are logged but do not throw.
 */
export async function reactToMessage(
  instanceName: string,
  key: { remoteJid: string; fromMe: boolean; id: string },
  reaction: string
): Promise<void> {
  try {
    await evoFetch(
      "/message/react",
      "POST",
      { key, reaction },
      instanceName
    );
  } catch (e) {
    console.warn("[reactToMessage] Failed (non-critical):", e instanceof Error ? e.message : String(e));
  }
}
