import { foundationPolicy, assertNoOutbound } from "./policy";
import { object, text } from "./events";

const allowedOperations = new Set(["GET /instance/all", "POST /instance/create", "POST /instance/connect", "GET /instance/status", "GET /instance/qr", "POST /instance/disconnect", "GET /group/list"]);

function usesNgrokBrowserWarning(hostname: string): boolean {
  return hostname.endsWith(".ngrok-free.app") || hostname.endsWith(".ngrok-free.dev");
}

type ProviderRequestOptions = { token?: string; instanceId?: string; body?: Record<string, unknown> };

async function executeProviderRequest(method: string, path: string, options: ProviderRequestOptions = {}): Promise<unknown> {
  if (process.env.FOUNDATION_PROVIDER_ENABLED !== "true") throw new Error("PROVIDER_DISABLED");
  const baseUrl = process.env.EVOLUTION_GO_URL;
  const apiKey = process.env.EVOLUTION_GO_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && process.env.ALLOW_LOCAL_PROVIDER_HTTP === "true")) throw new Error("INSECURE_PROVIDER_URL");
  if (url.username || url.password || url.search || url.hash) throw new Error("INVALID_PROVIDER_URL");
  // The Go reference authenticates instance operations with the instance token.
  // The alternate global-key/header mode requires explicit build qualification.
  const mode = process.env.EVOLUTION_GO_AUTH_MODE ?? "instance-token";
  if (!["global-instance", "instance-token"].includes(mode)) throw new Error("INVALID_PROVIDER_AUTH_MODE");
  const response = await fetch(`${url.toString().replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      apikey: mode === "instance-token" && options.token ? options.token : apiKey,
      ...(usesNgrokBrowserWarning(url.hostname) ? { "ngrok-skip-browser-warning": "pipelixr" } : {}),
      ...(options.instanceId ? { instanceId: options.instanceId } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(foundationPolicy().providerTimeoutMs),
    redirect: "error",
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_REQUEST_FAILED");
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("PROVIDER_REQUEST_FAILED");
  try {
    return await response.json();
  } catch {
    throw new Error("PROVIDER_REQUEST_FAILED");
  }
}

export async function providerRequest(method: string, path: string, options: ProviderRequestOptions = {}): Promise<unknown> {
  if (!allowedOperations.has(`${method} ${path}`)) assertNoOutbound(`${method} ${path}`);
  return executeProviderRequest(method, path, options);
}

// Text sending is intentionally absent from providerRequest's public operation
// allowlist. Only the internal assistant dispatch module imports this narrow
// capability after it has revalidated business consent and per-group opt-in.
export async function sendAuthorizedAssistantText(options: {
  token: string;
  instanceId: string;
  target: string;
  content: string;
  interactionId: string;
}): Promise<unknown> {
  if (!options.target || !options.content.trim() || options.content.length > 1_000) {
    throw new Error("INVALID_ASSISTANT_SEND");
  }
  return executeProviderRequest("POST", "/send/text", {
    token: options.token,
    instanceId: options.instanceId,
    body: { number: options.target, text: options.content, id: options.interactionId },
  });
}

export function providerInstanceId(result: unknown): string {
  const root = object(result);
  const data = object(root.data);
  const instance = object(root.instance ?? data.instance);
  return text(root.instanceId || root.id || data.instanceId || data.id || instance.id);
}

export type ProviderInstance = { id: string; name: string; token: string };

export function providerDisplayName(businessName: string, businessId: string): string {
  const normalized = businessName.trim().replace(/\s+/g, " ").slice(0, 80);
  return normalized || `Pipelixr ${businessId.slice(-8)}`;
}

export function providerInstances(result: unknown): ProviderInstance[] {
  const root = object(result);
  const records = Array.isArray(result)
    ? result
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(root.instances)
        ? root.instances
        : null;
  if (!records) throw new Error("PROVIDER_INSTANCE_UNRESOLVED");
  return records.slice(0, 1_000).map((value) => {
    const record = object(value);
    const data = object(record.data);
    const instance = object(record.instance ?? data.instance);
    return {
      id: text(record.instanceId ?? record.instance_id ?? record.id ?? data.instanceId ?? data.instance_id ?? data.id ?? instance.instanceId ?? instance.instance_id ?? instance.id),
      name: text(record.instanceName ?? record.instance_name ?? record.name ?? data.instanceName ?? data.instance_name ?? data.name ?? instance.instanceName ?? instance.instance_name ?? instance.name),
      token: text(record.token ?? data.token ?? instance.token),
    };
  }).filter((instance) => instance.id || instance.name);
}

export function providerConnectionState(result: unknown): "connected" | "pending" | "disconnected" {
  const root = object(result);
  const data = object(root.data);
  const record = Object.keys(data).length ? data : root;
  const state = text(record.state ?? record.status).toLowerCase();
  if (record.Connected === false || record.connected === false) return "disconnected";
  if ((record.Connected === true || record.connected === true) && (record.LoggedIn === false || record.loggedIn === false)) return "pending";
  if (record.LoggedIn === true || record.loggedIn === true || state === "open" || state === "connected") return "connected";
  if (state === "connecting" || state === "pending") return "pending";
  if (record.LoggedIn === false || record.loggedIn === false || state === "close" || state === "disconnected") return "disconnected";
  throw new Error("UNKNOWN_PROVIDER_STATE");
}

// These spellings come from the Go OpenAPI response schema and example, not
// speculative Evolution API aliases. Remote image URLs are never fetched.
export function providerQr(result: unknown): string {
  const root = object(result);
  const data = object(root.data);
  const nested = object(data.qrcode ?? data.qr ?? data.qrCode ?? root.qrcode ?? root.qr ?? root.qrCode);
  const instance = object(root.instance ?? data.instance);
  const instanceQr = object(instance.qrcode ?? instance.qr ?? instance.qrCode);
  return text(
    data.Qrcode ?? root.Qrcode ??
    nested.base64 ?? nested.code ?? nested.Qrcode ??
    data.qrcode ?? data.qrCode ?? root.qrcode ?? root.qrCode ??
    instanceQr.base64 ?? instanceQr.code ?? instance.qrcode ?? instance.Qrcode ??
    data.Code ?? root.Code,
    180000,
  );
}

export function providerErrorCode(error: unknown): string {
  const allowed = new Set(["PROVIDER_DISABLED", "PROVIDER_NOT_CONFIGURED", "INSECURE_PROVIDER_URL", "INVALID_PROVIDER_URL", "INVALID_PROVIDER_AUTH_MODE", "PROVIDER_AUTH_FAILED", "PROVIDER_REQUEST_FAILED", "UNKNOWN_PROVIDER_STATE", "PROVIDER_INSTANCE_UNRESOLVED"]);
  return error instanceof Error && allowed.has(error.message) ? error.message : "PROVIDER_UNAVAILABLE";
}

export type ProviderGroup = { jid: string; name: string; memberCount: number; role: "owner" | "admin" | "member" };

export function providerGroups(result: unknown): ProviderGroup[] {
  const root = object(result);
  const data = root.data;
  const dataObject = object(data);
  const records = Array.isArray(result)
    ? result
    : Array.isArray(data)
      ? data
      : Array.isArray(dataObject.groups)
        ? dataObject.groups
        : Array.isArray(root.groups)
          ? root.groups
          : [];
  const groups = new Map<string, ProviderGroup>();
  for (const value of records.slice(0, 500)) {
    const group = object(value);
    const jid = text(group.id ?? group.jid ?? group.groupJid ?? group.remoteJid ?? group.JID);
    if (!jid.endsWith("@g.us")) continue;
    const name = text(group.subject ?? group.name ?? group.groupName ?? group.Name ?? group.Subject, 120) || jid.split("@")[0];
    const participants = Array.isArray(group.participants) ? group.participants : Array.isArray(group.Participants) ? group.Participants : [];
    const rawCount = group.size ?? group.Size ?? group.ParticipantCount;
    const memberCount = participants.length || (typeof rawCount === "number" && Number.isFinite(rawCount) ? Math.max(0, Math.floor(rawCount)) : 0);
    const self = object(group.selfParticipant ?? group.SelfParticipant);
    const rawRole = text(group.selfRole ?? group.role ?? self.role ?? self.admin).toLowerCase();
    const role = group.isOwner === true || group.IsOwner === true || rawRole === "owner" || rawRole === "superadmin"
      ? "owner"
      : group.isAdmin === true || group.IsAdmin === true || self.isAdmin === true || self.IsAdmin === true || rawRole === "admin"
        ? "admin"
        : "member";
    groups.set(jid, { jid, name, memberCount, role });
  }
  return [...groups.values()];
}

export function providerSendResult(result: unknown): { messageId: string | null } {
  const root = object(result);
  const data = object(root.data);
  const key = object(data.key ?? root.key);
  const messageId = text(root.id ?? root.messageId ?? data.id ?? data.messageId ?? key.id);
  return { messageId: messageId || null };
}
