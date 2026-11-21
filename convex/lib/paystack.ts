const PAYSTACK_BASE_URL = "https://api.paystack.co";

export type ProviderObject = Record<string, unknown>;

function secretKey(): string {
  const value = process.env.PAYSTACK_SECRET_KEY;
  if (!value || !/^sk_(test|live)_[A-Za-z0-9]+$/.test(value)) throw new Error("PAYSTACK_NOT_CONFIGURED");
  return value;
}

export async function paystackRequest(path: string, init?: { method?: "GET" | "POST"; body?: Record<string, unknown> }): Promise<ProviderObject> {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const payload = await response.json().catch(() => null) as ProviderObject | null;
  if (!response.ok || !payload?.status) throw new Error(`PAYSTACK_REQUEST_FAILED:${response.status}`);
  return payload;
}

export function safeProviderString(value: unknown, maximum = 200): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, maximum) : undefined;
}

export function paystackTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export async function verifyPaystackSignature(rawBody: string, signature: string): Promise<boolean> {
  if (!/^[a-f0-9]{128}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secretKey()), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ signature.toLowerCase().charCodeAt(index);
  return difference === 0;
}
