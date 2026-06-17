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

type ProxySettings = {
  host: string;
  password: string;
  port: string;
  username: string;
};

type AdvancedSettings = {
  alwaysOnline: boolean;
  ignoreGroups: boolean;
  ignoreStatus: boolean;
  msgRejectCall: string;
  readMessages: boolean;
  rejectCall: boolean;
};

type CreateInstanceOptions = {
  displayName?: string;
  instanceId: string;
  token?: string;
  advancedSettings?: Partial<AdvancedSettings>;
  proxy?: Partial<ProxySettings>;
  qrcode?: boolean;
};

type ConnectInstanceOptions = {
  immediate?: boolean;
  instanceId: string;
  natsEnable?: boolean;
  phone?: string;
  rabbitmqEnable?: boolean;
  subscribe?: string[];
  token?: string;
  webhookUrl?: string;
  websocketEnable?: boolean;
};

const DEFAULT_SUBSCRIBED_EVENTS = ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT"];

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

    const qr = data.qrcode;
    const instance = data.instance;

    const qrCode =
      qr?.base64 ||
      qr?.code ||
      data.base64 ||
      data.code ||
      instance?.qrcode?.base64 ||
      instance?.qrcode?.code ||
      instance?.qrcode ||
      null;

    const pairingCode =
      data.pairingCode ||
      data.pairing_code ||
      data.pairCode ||
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

function getDefaultAdvancedSettings(): AdvancedSettings {
  return {
    alwaysOnline: false,
    ignoreGroups: false,
    ignoreStatus: false,
    msgRejectCall: "",
    readMessages: false,
    rejectCall: false,
  };
}

function normalizeProxySettings(proxy?: Partial<ProxySettings>): Partial<ProxySettings> | undefined {
  if (!proxy) return undefined;

  const normalized = Object.fromEntries(
    Object.entries(proxy).filter(([, value]) => typeof value === "string" && value.trim() !== "")
  ) as Partial<ProxySettings>;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function serializeConnectFlag(value?: boolean): string {
  return value ? "true" : "false";
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

function resolveInstanceToken(explicitToken?: string): string {
  const { apiKey } = getEvolutionConfig();
  return explicitToken || process.env.EVOLUTION_GO_INSTANCE_TOKEN || apiKey;
}

function buildCreateInstancePayload(instanceName: string, options?: CreateInstanceOptions): Record<string, unknown> {
  const proxy = normalizeProxySettings(options?.proxy);
  const instanceId = options?.instanceId || generateEvolutionInstanceId();

  return {
    instanceId,
    instanceName,
    name: options?.displayName || instanceName,
    advancedSettings: {
      ...getDefaultAdvancedSettings(),
      ...(options?.advancedSettings || {}),
    },
    qrcode: options?.qrcode ?? true,
    token: options?.token || instanceName,
    ...(proxy ? { proxy } : {}),
  };
}

function buildConnectPayload(instanceName: string, options?: ConnectInstanceOptions): Record<string, unknown> {
  const instanceId = options?.instanceId || generateEvolutionInstanceId();
  return {
    instanceId,
    instanceName,
    immediate: options?.immediate ?? false,
    // Evolution Go's connect endpoint expects these toggles as strings, not booleans.
    natsEnable: serializeConnectFlag(options?.natsEnable),
    phone: options?.phone || "",
    rabbitmqEnable: serializeConnectFlag(options?.rabbitmqEnable),
    subscribe: options?.subscribe || DEFAULT_SUBSCRIBED_EVENTS,
    token: options?.token || instanceName,
    webhookUrl: options?.webhookUrl || getEvolutionWebhookUrl() || "",
    websocketEnable: serializeConnectFlag(options?.websocketEnable),
  };
}

function buildPairPayload(instanceName: string, phone: string, options?: { instanceId: string; subscribe?: string[]; token?: string }): Record<string, unknown> {
  const instanceId = options?.instanceId || generateEvolutionInstanceId();
  return {
    instanceId,
    instanceName,
    phone,
    subscribe: options?.subscribe || DEFAULT_SUBSCRIBED_EVENTS,
    token: options?.token || instanceName,
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

/** Returns true if the named instance already exists on Evolution Go.
 * Handles both flat ({ instanceName }) and nested ({ instance: { instanceName } }) response shapes.
 */
export async function instanceExists(instanceName: string): Promise<boolean> {
  try {
    let rawData: any;
    try {
      rawData = await evoFetch("/instance/fetchInstances", "GET");
    } catch {
      rawData = await evoFetch("/instance/all", "GET");
    }
    const exists = !!extractMatchingInstance(rawData, instanceName);

    if (!exists) {
      console.warn(`[instanceExists] Instance ${instanceName} not found. Raw payload sample:`, rawData);
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
    let rawData: any;
    try {
      rawData = await evoFetch("/instance/fetchInstances", "GET");
    } catch {
      rawData = await evoFetch("/instance/all", "GET");
    }
    return extractMatchingInstance(rawData, instanceName);
  } catch (error) {
    console.error("[getInstanceRecord] Error:", error);
    return null;
  }
}

/** Deletes an instance, ignoring errors (e.g. if it doesn't exist). */
export async function deleteInstanceSilently(instanceName: string): Promise<void> {
  try {
    await evoFetch(`/instance/delete/${instanceName}`, "DELETE", undefined, instanceName);
  } catch {
    // ignore
  }
}

/** Creates a new WhatsApp instance on Evolution Go and returns any immediate connection artifacts. */
export async function createInstance(instanceName: string, options?: CreateInstanceOptions): Promise<ConnectionArtifacts> {
  const res = await evoFetch("/instance/create", "POST", buildCreateInstancePayload(instanceName, options)) as any;
  return parseConnectionArtifacts(res);
}

/** Starts the connection flow for an instance. */
export async function connectInstance(instanceName: string, options?: ConnectInstanceOptions): Promise<unknown> {
  return await evoFetch("/instance/connect", "POST", buildConnectPayload(instanceName, options), options?.token || instanceName);
}

/** Requests a phone-based pairing code for an instance. */
export async function pairInstance(
  instanceName: string,
  phone: string,
  options?: { instanceId: string; subscribe?: string[]; token?: string }
): Promise<ConnectionArtifacts> {
  const res = await evoFetch("/instance/pair", "POST", buildPairPayload(instanceName, phone, options), options?.token || instanceName) as any;
  return parseConnectionArtifacts(res);
}

/**
 * Configures webhook delivery for the instance by calling the connect endpoint
 * with the supplied webhook URL.
 */
export async function setWebhook(instanceName: string, webhookUrl: string, instanceId: string): Promise<void> {
  await connectInstance(instanceName, { instanceId, webhookUrl });
}

/** Returns the current connection artifacts for an instance. */
export async function getConnectionArtifacts(instanceName: string): Promise<ConnectionArtifacts> {
  try {
    const record = await getInstanceRecord(instanceName);
    if (record) {
      const artifacts = parseConnectionArtifacts(record);
      if (artifacts.qrCode || artifacts.pairingCode) {
        return artifacts;
      }
    }
  } catch {
    // fall through to endpoint-specific probes
  }

  const paths = [
    `/instance/qr`,
    `/instance/${encodeURIComponent(instanceName)}/qrcode`,
    `/instance/connect/${encodeURIComponent(instanceName)}`,
    `/instance/qr?instanceName=${encodeURIComponent(instanceName)}`,
    `/instance/qr/${encodeURIComponent(instanceName)}`,
  ];

  for (const path of paths) {
    try {
      const data = await evoFetch(path, "GET", undefined, instanceName);
      const artifacts = parseConnectionArtifacts(data);
      if (artifacts.qrCode || artifacts.pairingCode) {
        return artifacts;
      }
    } catch {
      // Try the next compatible endpoint shape.
    }
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

/** Returns the connection state: "open" | "close" | "connecting" */
export async function getConnectionState(instanceName: string): Promise<string> {
  let data: any;
  try {
    data = await evoFetch(`/instance/status`, "GET", undefined, instanceName);
  } catch (e: any) {
    try {
      data = await evoFetch(`/instance/connectionState/${instanceName}`, "GET");
    } catch (fallback) {
      data = await evoFetch(`/instance/${instanceName}/status`, "GET");
    }
  }
  return data?.instance?.state || data?.state || data?.status || "close";
}

/**
 * Sends a text message.
 * Enforces a 3-12 second random delay before the actual send (PRD requirement).
 */
export async function sendText(instanceName: string, to: string, text: string): Promise<void> {
  const delayMs = 3000 + Math.random() * 9000;
  await new Promise((r) => setTimeout(r, delayMs));
  await evoFetch(`/message/sendText/${instanceName}`, "POST", {
    number: to,
    text,
  }, instanceName);
}

/** Deletes an instance from Evolution Go. */
export async function deleteInstance(instanceName: string): Promise<void> {
  await evoFetch(`/instance/${instanceName}`, "DELETE", undefined, instanceName);
}
