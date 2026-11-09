function bytesToBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(""));
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encryptionKey(version: string): Uint8Array<ArrayBuffer> {
  const keys: Record<string, string> = JSON.parse(process.env.SESSION_ENCRYPTION_KEYS ?? "{}");
  const encoded = keys[version];
  if (!encoded) throw new Error("ENCRYPTION_NOT_CONFIGURED");
  const key = base64ToBytes(encoded);
  if (key.length !== 32) throw new Error("INVALID_ENCRYPTION_KEY");
  return key;
}

export async function encryptSecret(value: string, context: string): Promise<string> {
  const version = process.env.SESSION_ENCRYPTION_KEY_VERSION;
  if (!version || !/^[a-zA-Z0-9_-]+$/.test(version)) throw new Error("ENCRYPTION_NOT_CONFIGURED");
  const key = await crypto.subtle.importKey("raw", encryptionKey(version), "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(context) }, key, new TextEncoder().encode(value));
  return `${version}.${bytesToBase64(nonce)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(value: string, context: string): Promise<string> {
  const [version, nonce, ciphertext, extra] = value.split(".");
  if (!version || !nonce || !ciphertext || extra) throw new Error("INVALID_CIPHERTEXT");
  const key = await crypto.subtle.importKey("raw", encryptionKey(version), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(nonce), additionalData: new TextEncoder().encode(context) }, key, base64ToBytes(ciphertext));
  return new TextDecoder().decode(plaintext);
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function identityDigest(businessId: string, identity: string): Promise<string> {
  const encoded = process.env.IDENTITY_HASH_KEY;
  if (!encoded) throw new Error("IDENTITY_HASH_NOT_CONFIGURED");
  const bytes = base64ToBytes(encoded);
  if (bytes.length !== 32) throw new Error("INVALID_IDENTITY_HASH_KEY");
  const key = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${businessId}\n${identity}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function secretMatches(expected: string, received: string): boolean {
  if (expected.length !== received.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  return difference === 0;
}

export function randomToken(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
