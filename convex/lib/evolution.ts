import { foundationPolicy, assertNoOutbound } from "./policy";
import { object, text } from "./events";

const allowedOperations = new Set(["GET /instance/all", "POST /instance/create", "POST /instance/connect", "GET /instance/status", "GET /instance/qr", "POST /instance/disconnect"]);

export async function providerRequest(method: string, path: string, options: { token?: string; instanceId?: string; body?: Record<string, unknown> } = {}): Promise<unknown> {
  if (!allowedOperations.has(`${method} ${path}`)) assertNoOutbound(`${method} ${path}`);
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
      "Content-Type": "application/json",
      apikey: mode === "instance-token" && options.token ? options.token : apiKey,
      ...(options.instanceId ? { instanceId: options.instanceId } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(foundationPolicy().providerTimeoutMs),
    redirect: "error",
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_REQUEST_FAILED");
  return await response.json();
}

export function providerInstanceId(result: unknown): string {
  const root = object(result);
  const data = object(root.data);
  const instance = object(root.instance ?? data.instance);
  return text(root.instanceId || root.id || data.instanceId || data.id || instance.id);
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
  return text(data.Qrcode ?? data.qrcode ?? root.qrCode ?? root.qrcode ?? data.Code, 180000);
}

export function providerErrorCode(error: unknown): string {
  const allowed = new Set(["PROVIDER_DISABLED", "PROVIDER_NOT_CONFIGURED", "INSECURE_PROVIDER_URL", "INVALID_PROVIDER_URL", "INVALID_PROVIDER_AUTH_MODE", "PROVIDER_AUTH_FAILED", "PROVIDER_REQUEST_FAILED", "UNKNOWN_PROVIDER_STATE", "PROVIDER_INSTANCE_UNRESOLVED"]);
  return error instanceof Error && allowed.has(error.message) ? error.message : "PROVIDER_UNAVAILABLE";
}
