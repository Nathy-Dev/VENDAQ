import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import { api, internal } from "../convex/_generated/api";
import { encryptSecret, decryptSecret, identityDigest } from "../convex/lib/crypto";
import { providerRequest } from "../convex/lib/evolution";
import { normalizeEmail, validatePassword } from "../convex/lib/authentication";
import { mintConvexToken, publicJwks } from "../src/lib/convex-auth";
import { createHarness } from "./harness";

describe("foundation security invariants", () => {
  it("encrypts with random nonces, tenant-bound AAD, integrity and key-version rotation", async () => {
    const encrypted = await encryptSecret("synthetic-secret", "tenant:one");
    expect(encrypted).not.toContain("synthetic-secret");
    expect(await encryptSecret("synthetic-secret", "tenant:one")).not.toBe(encrypted);
    expect(await decryptSecret(encrypted, "tenant:one")).toBe("synthetic-secret");
    await expect(decryptSecret(encrypted, "tenant:two")).rejects.toThrow();
    await expect(decryptSecret(`${encrypted.slice(0, -6)}AAAAAA`, "tenant:one")).rejects.toThrow();
    vi.stubEnv("SESSION_ENCRYPTION_KEYS", JSON.stringify({ test: Buffer.alloc(32, 7).toString("base64"), rotated: Buffer.alloc(32, 8).toString("base64") }));
    vi.stubEnv("SESSION_ENCRYPTION_KEY_VERSION", "rotated");
    expect(await decryptSecret(encrypted, "tenant:one")).toBe("synthetic-secret");
    expect(await encryptSecret("new-secret", "tenant:one")).toMatch(/^rotated\./);
    expect(await identityDigest("one", "123@lid")).not.toBe(await identityDigest("two", "123@lid"));
  });

  it("signs short-lived canonical subjects and exposes only public JWKS fields", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    vi.stubEnv("AUTH_JWT_PRIVATE_KEY", Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"));
    vi.stubEnv("AUTH_JWT_KEY_ID", "synthetic-key");
    const keys = await publicJwks();
    expect(keys.keys[0]).not.toHaveProperty("d");
    expect(keys.keys[0]).not.toHaveProperty("p");
    const token = await mintConvexToken("google:seller-one");
    const verified = await jwtVerify(token, createLocalJWKSet(keys), { issuer: "https://auth.example.test", audience: "pipelixr", currentDate: new Date() });
    expect(verified.payload.sub).toBe("google:seller-one");
    expect(verified.payload.exp! - verified.payload.iat!).toBe(300);
    await expect(mintConvexToken("unverified-legacy-id")).rejects.toThrow();
    await expect(jwtVerify(token, createLocalJWKSet(keys), { audience: "other-product" })).rejects.toThrow();
  });

  it("normalizes credentials, rejects bcrypt truncation, and serializes auth limits", async () => {
    expect(normalizeEmail("  Seller@Example.test ")).toBe("seller@example.test");
    expect(() => validatePassword("tiny", true)).toThrow();
    expect(() => validatePassword("💚".repeat(30), true)).toThrow();
    const harness = createHarness();
    const attempts = await Promise.all(Array.from({ length: 20 }, () => harness.mutation(internal.users.consumeAuthAttempt, { key: "synthetic-digest" })));
    expect(attempts.filter(Boolean)).toHaveLength(10);
    vi.setSystemTime(Date.now() + 900001);
    expect(await harness.mutation(internal.users.consumeAuthAttempt, { key: "synthetic-digest" })).toBe(true);
    // bcrypt yields through timers internally; use real timers for this bounded
    // CPU operation rather than deadlocking its async callback on fake time.
    vi.useRealTimers();
    const userId = await harness.action(api.auth.createUser, { email: " SELLER@example.test ", password: "long-synthetic-password", name: "Synthetic seller" });
    const user = await harness.run((ctx) => ctx.db.get(userId));
    expect(user?.password).not.toBe("long-synthetic-password");
    expect(await harness.action(api.auth.verifyUser, { email: "seller@example.test", password: "incorrect-password" })).toBeNull();
    expect((await harness.action(api.auth.verifyUser, { email: "SELLER@example.test", password: "long-synthetic-password" }))?.id).toBe(userId);
  });

  it("blocks all legacy registered functions before database or network access", async () => {
    const modules = import.meta.glob("../convex/{ai,businesses,groups,interactions,orders,pipeline,safeguards,whatsapp,test,temp_test}.ts");
    let checked = 0;
    for (const load of Object.values(modules)) {
      const exports = await load() as Record<string, { isQuery?: boolean; isMutation?: boolean; isAction?: boolean; _handler?: (ctx: unknown, args: unknown) => unknown }>;
      for (const handler of Object.values(exports)) {
        if (!handler || !(handler.isQuery || handler.isMutation || handler.isAction)) continue;
        await expect(Promise.resolve().then(() => handler._handler!({}, {}))).rejects.toThrow("PHASE_DISABLED");
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["/send/text", "/send/image", "/message/read", "/message/react", "/chat/presence", "/group/send", "/instance/delete"])("denies %s regardless of provider enablement", async (path) => {
    vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
    await expect(providerRequest("POST", path)).rejects.toThrow("OUTBOUND_DISABLED");
    expect(fetch).not.toHaveBeenCalled();
  });
});
