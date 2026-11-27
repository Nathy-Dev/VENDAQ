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

  it("requires an exact business-name confirmation and deletes the tenant in bounded jobs", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "google:operator");
    const harness = createHarness();
    const seller = harness.withIdentity({ subject: "google:delete-me", issuer: "https://auth.example.test", email: "seller@example.test", emailVerified: true });
    const admin = harness.withIdentity({ subject: "google:operator", issuer: "https://auth.example.test" });
    await seller.mutation(api.users.upsertGoogleUser, {});
    const businessId = await seller.mutation(api.foundation.createBusiness, { name: "Delete Me Ltd" });
    await harness.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", { businessId, name: "Synthetic buyer", phone: "2348000000000", totalValue: 0, lastInteraction: Date.now(), tags: [] });
      await ctx.db.insert("orders", { businessId, customerId, items: [{ name: "Test", quantity: 1, price: 1000 }], totalAmount: 1000, status: "pending", createdAt: Date.now() });
    });

    await expect(admin.action(api.admin.requestAccountDeletion, { businessId, confirmation: "wrong name" })).rejects.toThrow("DELETION_CONFIRMATION_MISMATCH");
    await admin.action(api.admin.requestAccountDeletion, { businessId, confirmation: "Delete Me Ltd" });
    expect(await harness.run((ctx) => ctx.db.get(businessId))).toMatchObject({ foundationVersion: 0, killSwitch: true, aiEnabled: false });

    await harness.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await harness.run((ctx) => ctx.db.get(businessId))).toBeNull();
    expect(await harness.run((ctx) => ctx.db.query("users").withIndex("by_google_subject_and_email", (index) => index.eq("googleSubject", "google:delete-me")).unique())).toBeNull();
    expect(await harness.run((ctx) => ctx.db.query("customers").withIndex("by_business", (query) => query.eq("businessId", businessId)).take(1))).toHaveLength(0);
    expect(await harness.run((ctx) => ctx.db.query("orders").withIndex("by_business", (query) => query.eq("businessId", businessId)).take(1))).toHaveLength(0);
    expect(await admin.query(api.admin.deletionStatus, { businessId })).toMatchObject({ state: "done" });
  });
});
