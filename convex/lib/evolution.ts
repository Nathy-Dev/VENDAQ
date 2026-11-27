import { foundationPolicy, assertNoOutbound } from "./policy";
import { object, text } from "./events";

const allowedOperations = new Set(["GET /instance/all", "POST /instance/create", "POST /instance/connect", "POST /instance/pair", "GET /instance/status", "GET /instance/qr", "POST /instance/disconnect", "GET /group/list", "GET /user/contacts", "POST /user/info"]);

function usesNgrokBrowserWarning(hostname: string): boolean {
  return hostname.endsWith(".ngrok-free.app") || hostname.endsWith(".ngrok-free.dev");
}

type ProviderRequestOptions = { token?: string; instanceId?: string; body?: Record<string, unknown>; timeoutMs?: number };

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
    signal: AbortSignal.timeout(options.timeoutMs ?? foundationPolicy().providerTimeoutMs),
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

export async function showAuthorizedAssistantTyping(options: {
  token: string;
  instanceId: string;
  target: string;
  delayMs: number;
}): Promise<void> {
  if (!options.target || !Number.isSafeInteger(options.delayMs) || options.delayMs < 1_000 || options.delayMs > 60_000) {
    throw new Error("INVALID_ASSISTANT_TYPING");
  }
  await executeProviderRequest("POST", "/message/presence", {
    token: options.token,
    instanceId: options.instanceId,
    body: { number: options.target, state: "composing", isAudio: false, delay: options.delayMs },
    timeoutMs: options.delayMs + 5_000,
  });
}

export async function downloadAuthorizedInboundAudio(options: {
  token: string;
  instanceId: string;
  message: Record<string, unknown>;
  canProcess: () => Promise<boolean>;
}): Promise<{ bytes: Uint8Array; mimetype: string }> {
  if (!options.instanceId || Object.keys(options.message).length === 0) throw new Error("INVALID_AUDIO_DOWNLOAD");
  if (process.env.FOUNDATION_PROVIDER_ENABLED !== "true") throw new Error("PROVIDER_DISABLED");
  const baseUrl = process.env.EVOLUTION_GO_URL;
  const apiKey = process.env.EVOLUTION_GO_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && process.env.ALLOW_LOCAL_PROVIDER_HTTP === "true")) throw new Error("INSECURE_PROVIDER_URL");
  const mode = process.env.EVOLUTION_GO_AUTH_MODE ?? "instance-token";
  let lastError = "PROVIDER_AUDIO_DOWNLOAD_FAILED";
  for (const path of ["/message/downloadmedia", "/message/download", "/message/downloadimage"]) {
    if (!(await options.canProcess())) throw new Error("AI_ASSISTANT_PAUSED");
    const response = await fetch(`${url.toString().replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { Accept: "application/json, audio/*, application/octet-stream", "Content-Type": "application/json", apikey: mode === "instance-token" ? options.token : apiKey, instanceId: options.instanceId },
      body: JSON.stringify({ message: options.message }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (response.status === 404 || response.status === 405) continue;
    if (!response.ok) { lastError = response.status === 401 || response.status === 403 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_AUDIO_DOWNLOAD_FAILED"; break; }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      const root = object(await response.json());
      const data = object(root.data);
      let base64 = text(data.base64 ?? data.media ?? root.base64 ?? root.media, 20_000_000);
      if (base64.includes(",")) base64 = base64.split(",").pop() ?? "";
      if (!base64) throw new Error("PROVIDER_AUDIO_DOWNLOAD_FAILED");
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      if (bytes.byteLength === 0 || bytes.byteLength > 25_000_000) throw new Error("AUDIO_SIZE_NOT_SUPPORTED");
      return { bytes, mimetype: text(data.mimetype ?? data.mimeType ?? root.mimetype ?? root.mimeType, 120) || "audio/ogg" };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 25_000_000) throw new Error("AUDIO_SIZE_NOT_SUPPORTED");
    return { bytes, mimetype: contentType.split(";")[0] || "audio/ogg" };
  }
  throw new Error(lastError);
}

function detectedImageMimeType(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a") return "image/gif";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a") return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return "";
}

export async function downloadAuthorizedInboundImage(options: {
  token: string;
  instanceId: string;
  message: Record<string, unknown>;
  canProcess: () => Promise<boolean>;
}): Promise<{ bytes: Uint8Array; mimetype: string }> {
  if (!options.instanceId || Object.keys(options.message).length === 0) throw new Error("INVALID_IMAGE_DOWNLOAD");
  if (process.env.FOUNDATION_PROVIDER_ENABLED !== "true") throw new Error("PROVIDER_DISABLED");
  const baseUrl = process.env.EVOLUTION_GO_URL;
  const apiKey = process.env.EVOLUTION_GO_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && process.env.ALLOW_LOCAL_PROVIDER_HTTP === "true")) throw new Error("INSECURE_PROVIDER_URL");
  if (url.username || url.password || url.search || url.hash) throw new Error("INVALID_PROVIDER_URL");
  const mode = process.env.EVOLUTION_GO_AUTH_MODE ?? "instance-token";
  if (!["global-instance", "instance-token"].includes(mode)) throw new Error("INVALID_PROVIDER_AUTH_MODE");
  let lastError = "PROVIDER_IMAGE_DOWNLOAD_FAILED";
  for (const path of ["/message/downloadmedia", "/message/download", "/message/downloadimage"]) {
    if (!(await options.canProcess())) throw new Error("AI_ASSISTANT_PAUSED");
    const response = await fetch(`${url.toString().replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { Accept: "application/json, image/jpeg, image/png, image/webp, image/gif, application/octet-stream", "Content-Type": "application/json", apikey: mode === "instance-token" ? options.token : apiKey, instanceId: options.instanceId },
      body: JSON.stringify({ message: options.message }),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    if (response.status === 404 || response.status === 405) continue;
    if (!response.ok) { lastError = response.status === 401 || response.status === 403 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_IMAGE_DOWNLOAD_FAILED"; break; }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    let bytes: Uint8Array;
    let reportedMimeType = contentType.split(";")[0];
    if (contentType.includes("application/json")) {
      const root = object(await response.json());
      const data = object(root.data);
      let base64 = text(data.base64 ?? data.media ?? root.base64 ?? root.media, 14_000_000);
      if (base64.includes(",")) base64 = base64.split(",").pop() ?? "";
      if (!base64) throw new Error("PROVIDER_IMAGE_DOWNLOAD_FAILED");
      const binary = atob(base64);
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      reportedMimeType = text(data.mimetype ?? data.mimeType ?? root.mimetype ?? root.mimeType, 120).split(";")[0].toLowerCase();
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (bytes.byteLength === 0 || bytes.byteLength > 10_000_000) throw new Error("IMAGE_SIZE_NOT_SUPPORTED");
    const detectedMimeType = detectedImageMimeType(bytes);
    if (!detectedMimeType) throw new Error("IMAGE_TYPE_NOT_SUPPORTED");
    if (reportedMimeType.startsWith("image/") && reportedMimeType !== detectedMimeType) throw new Error("IMAGE_TYPE_MISMATCH");
    return { bytes, mimetype: detectedMimeType };
  }
  throw new Error(lastError);
}

export function providerInstanceId(result: unknown): string {
  const root = object(result);
  const data = object(root.data);
  const instance = object(root.instance ?? data.instance);
  return text(root.instanceId || root.id || data.instanceId || data.id || instance.id);
}

export type ProviderInstance = { id: string; name: string; token: string; jid: string };

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
      jid: text(record.jid ?? record.JID ?? data.jid ?? data.JID ?? instance.jid ?? instance.JID),
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

export function providerPairingCode(result: unknown): string | null {
  const root = object(result);
  const data = object(root.data);
  const code = data.PairingCode ?? data.pairingCode ?? root.PairingCode ?? root.pairingCode;
  return typeof code === "string" && /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(code) ? code : null;
}

export function providerErrorCode(error: unknown): string {
  const allowed = new Set(["PROVIDER_DISABLED", "PROVIDER_NOT_CONFIGURED", "INSECURE_PROVIDER_URL", "INVALID_PROVIDER_URL", "INVALID_PROVIDER_AUTH_MODE", "PROVIDER_AUTH_FAILED", "PROVIDER_REQUEST_FAILED", "UNKNOWN_PROVIDER_STATE", "PROVIDER_INSTANCE_UNRESOLVED"]);
  return error instanceof Error && allowed.has(error.message) ? error.message : "PROVIDER_UNAVAILABLE";
}

export type ProviderGroup = { jid: string; name: string; memberCount: number; role: "owner" | "admin" | "member" };
export type ProviderContact = { jid: string; name: string };
export type ProviderIdentityMapping = { canonicalJid: string; aliases: string[] };

function comparableAccountJid(value: unknown): string {
  const jid = text(value).trim().toLowerCase();
  const match = jid.match(/^([^:@]+)(?::\d+)?@(s\.whatsapp\.net|lid)$/);
  return match ? `${match[1]}@${match[2]}` : "";
}

function accountJids(...values: unknown[]): Set<string> {
  return new Set(values.map(comparableAccountJid).filter(Boolean));
}

function recordsFromProvider(result: unknown): unknown[] {
  const root = object(result);
  const data = root.data;
  return Array.isArray(result) ? result : Array.isArray(data) ? data : [];
}

export function providerContacts(result: unknown): ProviderContact[] {
  const contacts = new Map<string, ProviderContact>();
  for (const value of recordsFromProvider(result).slice(0, 10_000)) {
    const contact = object(value);
    const jid = comparableAccountJid(contact.Jid ?? contact.jid ?? contact.JID);
    if (!jid || !jid.endsWith("@s.whatsapp.net")) continue;
    // FullName and FirstName come from the owner's saved address book. PushName
    // and BusinessName are fallbacks only when no saved name exists.
    const name = [contact.FullName, contact.fullName, contact.FirstName, contact.firstName, contact.BusinessName, contact.businessName, contact.PushName, contact.pushName]
      .map((candidate) => text(candidate, 120).trim())
      .find(Boolean) ?? "";
    if (name) contacts.set(jid, { jid, name });
  }
  return [...contacts.values()];
}

export function providerAccountAliases(result: unknown): string[] {
  const root = object(result);
  const data = object(root.data);
  const users = object(data.Users ?? data.users);
  const aliases = new Set<string>();
  for (const [key, value] of Object.entries(users).slice(0, 10)) {
    const record = object(value);
    for (const candidate of [key, record.JID, record.jid, record.LID, record.lid]) {
      const jid = comparableAccountJid(candidate);
      if (jid) aliases.add(jid);
    }
  }
  return [...aliases];
}

export function providerIdentityMappings(result: unknown): ProviderIdentityMapping[] {
  const root = object(result);
  const data = object(root.data);
  const users = object(data.Users ?? data.users);
  const mappings = new Map<string, Set<string>>();
  for (const [key, value] of Object.entries(users).slice(0, 1_000)) {
    const record = object(value);
    const candidates = [key, record.JID, record.jid, record.LID, record.lid].map(comparableAccountJid).filter(Boolean);
    const canonicalJid = candidates.find((jid) => jid.endsWith("@s.whatsapp.net"));
    if (!canonicalJid) continue;
    const aliases = mappings.get(canonicalJid) ?? new Set<string>();
    for (const jid of candidates) aliases.add(jid);
    mappings.set(canonicalJid, aliases);
  }
  return [...mappings].map(([canonicalJid, aliases]) => ({ canonicalJid, aliases: [...aliases] }));
}

function sharesAccountJid(left: Set<string>, right: Set<string>): boolean {
  for (const jid of left) if (right.has(jid)) return true;
  return false;
}

function participantRole(value: unknown): "owner" | "admin" | "member" {
  const participant = object(value);
  const rawRole = text(participant.role ?? participant.Role ?? participant.admin ?? participant.Admin).toLowerCase();
  if (participant.IsSuperAdmin === true || participant.isSuperAdmin === true || rawRole === "owner" || rawRole === "superadmin") return "owner";
  if (participant.IsAdmin === true || participant.isAdmin === true || rawRole === "admin") return "admin";
  return "member";
}

export function providerGroups(result: unknown, connectedAccountJid: string | string[] = ""): ProviderGroup[] {
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
  const connectedJids = accountJids(...(Array.isArray(connectedAccountJid) ? connectedAccountJid : [connectedAccountJid]));
  for (const value of records.slice(0, 500)) {
    const group = object(value);
    const jid = text(group.id ?? group.jid ?? group.groupJid ?? group.remoteJid ?? group.JID);
    if (!jid.endsWith("@g.us")) continue;
    const groupName = object(group.GroupName);
    const name = text(group.subject ?? group.name ?? group.groupName ?? group.Name ?? group.Subject ?? groupName.Name ?? groupName.name, 120) || jid.split("@")[0];
    const participants = Array.isArray(group.participants) ? group.participants : Array.isArray(group.Participants) ? group.Participants : [];
    const rawCount = group.size ?? group.Size ?? group.ParticipantCount;
    const memberCount = participants.length || (typeof rawCount === "number" && Number.isFinite(rawCount) ? Math.max(0, Math.floor(rawCount)) : 0);
    const self = object(group.selfParticipant ?? group.SelfParticipant);
    const rawRole = text(group.selfRole ?? group.role ?? self.role ?? self.admin).toLowerCase();
    const reportedSelfJids = accountJids(group.selfJid, group.SelfJid, group.selfParticipantId, group.SelfParticipantId, group.selfPhoneNumber, group.SelfPhoneNumber);
    const effectiveSelfJids = connectedJids.size ? connectedJids : reportedSelfJids;
    const ownerJids = accountJids(group.owner, group.OwnerJID, group.ownerJid, group.OwnerPN, group.ownerPN);
    const matchedParticipant = effectiveSelfJids.size
      ? participants.find((participant) => {
          const record = object(participant);
          const participantJids = accountJids(record.id, record.jid, record.JID, record.lid, record.LID, record.phoneNumber, record.PhoneNumber);
          return sharesAccountJid(effectiveSelfJids, participantJids);
        })
      : undefined;
    const matchedRole = participantRole(matchedParticipant);
    const role = group.isOwner === true || group.IsOwner === true || rawRole === "owner" || rawRole === "superadmin" || sharesAccountJid(effectiveSelfJids, ownerJids) || matchedRole === "owner"
      ? "owner"
      : group.isAdmin === true || group.IsAdmin === true || self.isAdmin === true || self.IsAdmin === true || rawRole === "admin" || matchedRole === "admin"
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
