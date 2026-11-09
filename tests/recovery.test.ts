import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { createHarness, drain, message, tenant, webhook } from "./harness";

describe("durable recovery and privacy", () => {
  it("uses bounded backoff, exposes a dead letter, and replays once without duplicate effects", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source));
    const [event] = await harness.run((ctx) => ctx.db.query("inboundEvents").collect());
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claimed = await harness.mutation(internal.ingestion.claimEvent, { eventId: event._id });
      expect(claimed?.attempts).toBe(attempt);
      await harness.mutation(internal.ingestion.failEvent, { eventId: event._id, attempt, jitterMs: 100 });
      const failed = await harness.run((ctx) => ctx.db.get(event._id));
      expect(failed?.state).toBe(attempt < 5 ? "pending" : "dead_letter");
      if (attempt < 5) {
        expect(failed!.dueAt - Date.now()).toBe(2000 * 2 ** (attempt - 1) + 100);
        vi.setSystemTime(failed!.dueAt);
      }
    }
    expect(await source.owner.query(api.foundation.failures, { businessId: source.businessId })).toHaveLength(1);
    const other = await tenant(harness, "other");
    await expect(other.owner.mutation(api.foundation.retryEvent, { businessId: other.businessId, eventId: event._id })).rejects.toThrow("NOT_FOUND");
    await source.owner.mutation(api.foundation.retryEvent, { businessId: source.businessId, eventId: event._id });
    await drain(harness);
    expect(await harness.run((ctx) => ctx.db.query("interactions").collect())).toHaveLength(1);
    expect(await source.owner.query(api.foundation.failures, { businessId: source.businessId })).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("recovers abandoned claims and rejects stale attempt completions", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source));
    const [event] = await harness.run((ctx) => ctx.db.query("inboundEvents").collect());
    await harness.mutation(internal.ingestion.claimEvent, { eventId: event._id });
    vi.setSystemTime(Date.now() + 60001);
    await harness.mutation(internal.maintenance.sweep, {});
    const next = await harness.mutation(internal.ingestion.claimEvent, { eventId: event._id });
    expect(next?.attempts).toBe(2);
    await harness.mutation(internal.ingestion.applyEvent, { eventId: event._id, attempt: 1 });
    expect(await harness.run((ctx) => ctx.db.query("interactions").collect())).toHaveLength(0);
    await harness.mutation(internal.ingestion.applyEvent, { eventId: event._id, attempt: 2 });
    expect(await harness.run((ctx) => ctx.db.query("interactions").collect())).toHaveLength(1);
    await drain(harness);
  });

  it("deletes in batches, clears queued personal content, and prevents re-import", async () => {
    vi.stubEnv("FOUNDATION_BATCH_SIZE", "2");
    const harness = createHarness();
    const source = await tenant(harness);
    const other = await tenant(harness, "other");
    for (let index = 0; index < 5; index++) await webhook(harness, message(source, { id: `message-${index}` }));
    await webhook(harness, message(other));
    await drain(harness);
    const [contact] = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    await webhook(harness, message(source, { id: "still-queued" }));
    const jobId = await source.owner.mutation(api.foundation.deleteCustomer, { businessId: source.businessId, customerId: contact.customerId });
    expect(await source.owner.query(api.foundation.customers, { businessId: source.businessId })).toHaveLength(0);
    await expect(source.owner.query(api.foundation.messages, { businessId: source.businessId, customerId: contact.customerId })).rejects.toThrow("NOT_FOUND");
    await drain(harness);
    expect((await harness.run((ctx) => ctx.db.get(jobId)))?.state).toBe("done");
    const events = await harness.run((ctx) => ctx.db.query("inboundEvents").collect());
    expect(events.filter((event) => event.businessId === source.businessId).every((event) => event.payload === undefined)).toBe(true);
    await webhook(harness, message(source, { id: "after-deletion" }));
    await drain(harness);
    expect(await harness.run((ctx) => ctx.db.query("interactions").collect())).toHaveLength(1);
    expect(await source.owner.query(api.foundation.customers, { businessId: source.businessId })).toHaveLength(0);
    expect(await other.owner.query(api.foundation.customers, { businessId: other.businessId })).toHaveLength(1);
    expect(await source.owner.mutation(api.foundation.deleteCustomer, { businessId: source.businessId, customerId: contact.customerId })).toBe(jobId);
  });

  it("ages out content and profiles without recreating old messages on replay", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await harness.run((ctx) => ctx.db.patch(source.businessId, { messageRetentionDays: 1 }));
    const body = message(source);
    await webhook(harness, body);
    await drain(harness);
    vi.setSystemTime(Date.now() + 8 * 86400000);
    // Retention is applied by the deterministic maintenance sweep rather than
    // clock reads inside reactive queries.
    expect(await source.owner.query(api.foundation.customers, { businessId: source.businessId })).toHaveLength(1);
    await harness.mutation(internal.maintenance.sweep, {});
    expect(await harness.run((ctx) => ctx.db.query("interactions").collect())).toHaveLength(0);
    expect(await harness.run((ctx) => ctx.db.query("customers").collect())).toHaveLength(0);
    expect(await harness.run((ctx) => ctx.db.query("inboundEvents").collect())).toHaveLength(0);
    await webhook(harness, body);
    await drain(harness);
    expect(await harness.run((ctx) => ctx.db.query("interactions").collect())).toHaveLength(0);
  });

  it("exhausts failed deletion jobs visibly instead of retrying forever", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source));
    await drain(harness);
    const [contact] = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    const jobId = await source.owner.mutation(api.foundation.deleteCustomer, { businessId: source.businessId, customerId: contact.customerId });
    await harness.run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      await ctx.scheduler.cancel(job!.scheduledId!);
      await ctx.db.patch(jobId, { attempts: 5 });
    });
    await harness.mutation(internal.maintenance.sweep, {});
    expect((await source.owner.query(api.foundation.privacyJobs, { businessId: source.businessId }))[0].state).toBe("dead_letter");
    await source.owner.mutation(api.foundation.retryDeletion, { businessId: source.businessId, jobId });
    await drain(harness);
    expect((await harness.run((ctx) => ctx.db.get(jobId)))?.state).toBe("done");
  });

  it("keeps legacy data in place and checkpoints dry-run/resumable migrations", async () => {
    vi.stubEnv("FOUNDATION_BATCH_SIZE", "1");
    const harness = createHarness();
    const legacyIds = await harness.run(async (ctx) => Promise.all(["old-a", "old-b"].map((ownerId) => ctx.db.insert("businesses", { name: ownerId, ownerId, whatsappStatus: "connected", onboardingStep: 4, connectionDetails: { token: "synthetic-old-secret" } }))));
    await harness.mutation(internal.migrations.foundationV1, { dryRun: true });
    expect((await harness.run((ctx) => ctx.db.get(legacyIds[0])))?.foundationVersion).toBeUndefined();
    const first = await harness.mutation(internal.migrations.foundationV1, { dryRun: false });
    expect(first.complete).toBe(false);
    await expect(harness.mutation(internal.migrations.foundationV1, { dryRun: false })).rejects.toThrow("MIGRATION_CURSOR_MISMATCH");
    await harness.mutation(internal.migrations.foundationV1, { dryRun: false, cursor: first.cursor! });
    const repeated = await harness.mutation(internal.migrations.foundationV1, { dryRun: false });
    expect(repeated.processed).toBe(0);
    const business = await harness.run((ctx) => ctx.db.get(legacyIds[0]));
    expect(business?.ownerId).toBe("old-a");
    expect(business?.connectionDetails.token).toBe("synthetic-old-secret");
    expect(business?.killSwitch).toBe(true);
    expect(business?.foundationVersion).toBe(0);
  });
});
