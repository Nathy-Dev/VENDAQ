import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { createHarness, drain, message, tenant, webhook } from "./harness";

describe("Phase 2 read-only revenue evidence", () => {
  it("classifies inbound buying signals and reports them only after the response window", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await harness.run((ctx) => ctx.db.patch(source.businessId, { responseWindowMinutes: 15 }));
    const receivedAt = Date.now();
    await webhook(harness, message(source, { at: receivedAt }));
    const [event] = await harness.run((ctx) => ctx.db.query("inboundEvents").collect());
    const claimed = await harness.mutation(internal.ingestion.claimEvent, { eventId: event._id });
    await harness.mutation(internal.ingestion.applyEvent, { eventId: event._id, attempt: claimed!.attempts });
    const [interaction] = await harness.run((ctx) => ctx.db.query("interactions").collect());
    const [opportunity] = await harness.run((ctx) => ctx.db.query("missedRevenueOpportunities").collect());
    expect(interaction.classifierLabel).toBe("buying_signal");
    expect(opportunity.state).toBe("pending");
    expect(await source.owner.query(api.readOnly.missedRevenueReport, { businessId: source.businessId })).toHaveLength(0);
    vi.setSystemTime(receivedAt + 15 * 60000 + 1);
    await harness.mutation(internal.readOnly.promoteOpportunity, { opportunityId: opportunity._id });
    const report = await source.owner.query(api.readOnly.missedRevenueReport, { businessId: source.businessId });
    expect(report).toHaveLength(1);
    expect(report[0].message).toBe("How much for this one?");
    expect(report[0].responseWindowMinutes).toBe(15);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("closes evidence when the seller replies before or after the deadline", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await harness.run((ctx) => ctx.db.patch(source.businessId, { responseWindowMinutes: 15 }));
    const receivedAt = Date.now();
    await webhook(harness, message(source, { at: receivedAt }));
    await drain(harness);
    await webhook(harness, message(source, { id: "owner-before", fromMe: true, at: receivedAt + 60000, content: { conversation: "Available" } }));
    await drain(harness);
    expect((await harness.run((ctx) => ctx.db.query("missedRevenueOpportunities").collect()))[0].state).toBe("answered");

    await webhook(harness, message(source, { id: "buy-two", at: receivedAt + 1200000 }));
    await drain(harness);
    const opportunities = await harness.run((ctx) => ctx.db.query("missedRevenueOpportunities").collect());
    const second = opportunities.find((entry) => entry.interactionId !== opportunities[0].interactionId)!;
    vi.setSystemTime(second.dueAt + 1);
    await harness.mutation(internal.readOnly.promoteOpportunity, { opportunityId: second._id });
    expect(await source.owner.query(api.readOnly.missedRevenueReport, { businessId: source.businessId })).toHaveLength(1);
    await webhook(harness, message(source, { id: "owner-after", fromMe: true, at: second.dueAt + 2, content: { conversation: "Sorry for the delay" } }));
    await drain(harness);
    expect(await source.owner.query(api.readOnly.missedRevenueReport, { businessId: source.businessId })).toHaveLength(0);
  });

  it("handles owner-first delivery and ignores non-buying classes and duplicate webhooks", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const base = Date.now();
    await webhook(harness, message(source, { id: "owner-first", fromMe: true, at: base + 1000, content: { conversation: "Yes" } }));
    await drain(harness);
    await webhook(harness, message(source, { id: "older-buy", at: base }));
    await webhook(harness, message(source, { id: "older-buy", at: base }));
    await webhook(harness, message(source, { id: "inquiry", at: base + 2000, content: { conversation: "Do you deliver?" } }));
    await webhook(harness, message(source, { id: "payment", at: base + 3000, content: { conversation: "Payment sent" } }));
    await webhook(harness, message(source, { id: "audio", at: base + 4000, content: { audioMessage: {} } }));
    await drain(harness);
    const opportunities = await harness.run((ctx) => ctx.db.query("missedRevenueOpportunities").collect());
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].state).toBe("answered");
  });

  it("keeps human labels separate, tenant scoped, and evaluable", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const other = await tenant(harness, "other");
    await webhook(harness, message(source));
    await drain(harness);
    const [entry] = await source.owner.query(api.readOnly.labelQueue, { businessId: source.businessId });
    const labelId = await source.owner.mutation(api.readOnly.setLabel, { businessId: source.businessId, interactionId: entry.interactionId, label: "buying_signal" });
    expect(await source.owner.mutation(api.readOnly.setLabel, { businessId: source.businessId, interactionId: entry.interactionId, label: "inquiry" })).toBe(labelId);
    expect((await harness.run((ctx) => ctx.db.get(entry.interactionId)))?.classifierLabel).toBe("buying_signal");
    const evaluation = await source.owner.query(api.readOnly.evaluation, { businessId: source.businessId });
    expect(evaluation).toMatchObject({ samples: 1, truePositive: 0, falsePositive: 1, falseNegative: 0, precision: 0, recall: 0 });
    await expect(other.owner.query(api.readOnly.labelQueue, { businessId: source.businessId })).rejects.toThrow("NOT_FOUND");
    await expect(other.owner.mutation(api.readOnly.setLabel, { businessId: other.businessId, interactionId: entry.interactionId, label: "buying_signal" })).rejects.toThrow("NOT_FOUND");
    await source.owner.mutation(api.readOnly.setResponseWindow, { businessId: source.businessId, responseWindowMinutes: 45 });
    expect((await source.owner.query(api.foundation.workspace, {}))?.responseWindowMinutes).toBe(45);
    await expect(other.owner.mutation(api.readOnly.setResponseWindow, { businessId: source.businessId, responseWindowMinutes: 60 })).rejects.toThrow("NOT_FOUND");
    await expect(source.owner.mutation(api.readOnly.setResponseWindow, { businessId: source.businessId, responseWindowMinutes: 14 })).rejects.toThrow("INVALID_RESPONSE_WINDOW");
  });

  it("purges labels and opportunities with customer deletion and retention", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source));
    await drain(harness);
    const [entry] = await source.owner.query(api.readOnly.labelQueue, { businessId: source.businessId });
    await source.owner.mutation(api.readOnly.setLabel, { businessId: source.businessId, interactionId: entry.interactionId, label: "buying_signal" });
    const [contact] = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    await source.owner.mutation(api.foundation.deleteCustomer, { businessId: source.businessId, customerId: contact.customerId });
    await drain(harness);
    expect(await harness.run((ctx) => ctx.db.query("messageLabels").collect())).toHaveLength(0);
    expect(await harness.run((ctx) => ctx.db.query("missedRevenueOpportunities").collect())).toHaveLength(0);

    const retained = await tenant(harness, "retained");
    await harness.run((ctx) => ctx.db.patch(retained.businessId, { messageRetentionDays: 1 }));
    await webhook(harness, message(retained));
    await drain(harness);
    const [retainedEntry] = await retained.owner.query(api.readOnly.labelQueue, { businessId: retained.businessId });
    await retained.owner.mutation(api.readOnly.setLabel, { businessId: retained.businessId, interactionId: retainedEntry.interactionId, label: "buying_signal" });
    vi.setSystemTime(Date.now() + 2 * 86400000);
    await harness.mutation(internal.maintenance.sweep, {});
    expect(await harness.run((ctx) => ctx.db.query("messageLabels").collect())).toHaveLength(0);
    expect(await harness.run((ctx) => ctx.db.query("missedRevenueOpportunities").collect())).toHaveLength(0);
  });

  it("checkpoints Phase 2 without backfilling historical messages", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await harness.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", { businessId: source.businessId, phone: "historical", totalValue: 0, lastInteraction: Date.now(), tags: [] });
      await ctx.db.insert("interactions", { businessId: source.businessId, customerId, role: "customer", content: "How much?", timestamp: Date.now() });
    });
    const dryRun = await harness.mutation(internal.migrations.phase2ReadOnly, { dryRun: true });
    expect(dryRun).toEqual({ complete: true, historicalInteractionsBackfilled: false });
    expect(await harness.run((ctx) => ctx.db.query("foundationMigrations").withIndex("by_version", (builder) => builder.eq("version", 2)).unique())).toBeNull();
    await harness.mutation(internal.migrations.phase2ReadOnly, { dryRun: false });
    expect(await harness.run((ctx) => ctx.db.query("missedRevenueOpportunities").collect())).toHaveLength(0);
    expect((await harness.run((ctx) => ctx.db.query("foundationMigrations").withIndex("by_version", (builder) => builder.eq("version", 2)).unique()))?.state).toBe("done");
  });
});
