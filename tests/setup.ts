import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
  // These deterministic keys are synthetic test fixtures, never deployment keys.
  vi.stubEnv("AUTH_JWT_ISSUER", "https://auth.example.test");
  vi.stubEnv("SESSION_ENCRYPTION_KEYS", JSON.stringify({ test: Buffer.alloc(32, 7).toString("base64") }));
  vi.stubEnv("SESSION_ENCRYPTION_KEY_VERSION", "test");
  vi.stubEnv("IDENTITY_HASH_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "false");
  vi.stubEnv("FOUNDATION_PROVIDER_CONTRACT_VERIFIED", "false");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("NETWORK_DISABLED_IN_TEST")));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
