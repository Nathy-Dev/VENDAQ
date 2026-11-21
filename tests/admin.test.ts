import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { createHarness } from "./harness";

describe("admin console authorization", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when no allowlist is configured", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "");
    const harness = createHarness();
    const candidate = harness.withIdentity({ subject: "google:operator", issuer: "https://auth.example.test" });
    await expect(candidate.query(api.admin.overview, { rangeDays: 30 })).rejects.toThrow("ADMIN_FORBIDDEN");
  });

  it("allows only exact authenticated subjects", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "google:operator, credentials:backup-admin");
    const harness = createHarness();
    const admin = harness.withIdentity({ subject: "google:operator", issuer: "https://auth.example.test" });
    const seller = harness.withIdentity({ subject: "google:seller", issuer: "https://auth.example.test" });

    expect(await admin.query(api.admin.access, {})).toEqual({ isAdmin: true, configured: true });
    expect(await seller.query(api.admin.access, {})).toEqual({ isAdmin: false, configured: true });
    await expect(seller.query(api.admin.businesses, {})).rejects.toThrow("ADMIN_FORBIDDEN");
    const overview = await admin.query(api.admin.overview, { rangeDays: 30 });
    expect(overview.businesses.total).toBe(0);
    expect(overview.subscriptions.mrrKobo).toBe(0);
  });
});
