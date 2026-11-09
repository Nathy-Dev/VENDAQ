import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createHarness, message, tenant, webhook, type Harness } from "./harness";

async function processLatestEvent(harness: Harness) {
  const events = await harness.run((ctx) => ctx.db.query("inboundEvents").collect());
  const event = events.filter((entry) => entry.state === "pending").at(-1)!;
  const claimed = await harness.mutation(internal.ingestion.claimEvent, { eventId: event._id });
  await harness.mutation(internal.ingestion.applyEvent, { eventId: event._id, attempt: claimed!.attempts });
}

async function promoteLatest(harness: Harness) {
  const opportunities = await harness.run((ctx) => ctx.db.query("missedRevenueOpportunities").collect());
  const opportunity = opportunities.filter((entry) => entry.state === "pending").at(-1)!;
  vi.setSystemTime(opportunity.dueAt + 1);
  await harness.mutation(internal.readOnly.promoteOpportunity, { opportunityId: opportunity._id });
  return opportunity;
}

async function createMissedTask(harness: Harness, source: Awaited<ReturnType<typeof tenant>>, options: { id?: string; at?: number } = {}) {
  await harness.run((ctx) => ctx.db.patch(source.businessId, { responseWindowMinutes: 15 }));
  await webhook(harness, message(source, { id: options.id, at: options.at }));
  await processLatestEvent(harness);
  return promoteLatest(harness);
}

describe("Phase 3 suggest-first follow-ups", () => {
  it("creates exactly one guarded task for a missed buying signal without network calls", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const opportunity = await createMissedTask(harness, source);
    await harness.mutation(internal.readOnly.promoteOpportunity, { opportunityId: opportunity._id });
    await harness.mutation(internal.followUps.createTask, { opportunityId: opportunity._id });
    const tasks = await harness.run((ctx) => ctx.db.query("followUpTasks").collect());
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ opportunityId: opportunity._id, status: "pending", draftSource: "template", aiState: "disabled", journeyStage: "intent" });
    expect(tasks[0].draftText).toContain("still need help");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not create a task when either party has already replied and cancels a created task on reply", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const base = Date.now();
    await webhook(harness, message(source, { id: "owner-newer", fromMe: true, at: base + 1000, content: { conversation: "Yes, I can help" } }));
    await processLatestEvent(harness);
    await webhook(harness, message(source, { id: "customer-older", at: base }));
    await processLatestEvent(harness);
    const [answered] = await harness.run((ctx) => ctx.db.query("missedRevenueOpportunities").collect());
    vi.setSystemTime(answered.dueAt + 1);
    await harness.mutation(internal.readOnly.promoteOpportunity, { opportunityId: answered._id });
    expect(await harness.run((ctx) => ctx.db.query("followUpTasks").collect())).toHaveLength(0);

    const triggerAt = answered.dueAt + 60000;
    const opportunity = await createMissedTask(harness, source, { id: "new-buy", at: triggerAt });
    const [task] = await harness.run((ctx) => ctx.db.query("followUpTasks").collect());
    await webhook(harness, message(source, { id: "reply-after-task", fromMe: true, at: opportunity.dueAt + 2, content: { conversation: "Sorry for the delay" } }));
    await processLatestEvent(harness);
    expect((await harness.run((ctx) => ctx.db.get(task._id)))?.status).toBe("cancelled");
    expect((await harness.run((ctx) => ctx.db.get(task._id)))?.cancellationReason).toBe("SELLER_REPLIED");
  });

  it("enforces customer cooldowns, daily caps, and configured work hours", async () => {
    vi.setSystemTime(Date.parse("2026-10-27T05:59:00.000Z"));
    const harness = createHarness();
    const source = await tenant(harness);
    await harness.run((ctx) => ctx.db.patch(source.businessId, { responseWindowMinutes: 15, followUpCooldownMinutes: 1440, dailySuggestionCap: 1, followUpWorkHoursEnabled: true, followUpWorkHoursStart: 9 * 60, followUpWorkHoursEnd: 10 * 60, followUpQuietHoursEnabled: false }));
    const first = await createMissedTask(harness, source, { id: "first", at: Date.parse("2026-10-27T06:00:00.000Z") });
    const [firstTask] = await harness.run((ctx) => ctx.db.query("followUpTasks").collect());
    expect(new Date(firstTask.availableAt!).toISOString()).toBe("2026-10-27T08:00:00.000Z");

    const secondCustomerSource = { ...source };
    await webhook(harness, message(secondCustomerSource, { id: "second", chat: "2348000000002@s.whatsapp.net", at: first.triggerAt + 60000 }));
    await processLatestEvent(harness);
    await promoteLatest(harness);
    const tasks = await harness.run((ctx) => ctx.db.query("followUpTasks").collect());
    expect(tasks).toHaveLength(2);
    expect(tasks[1].availableAt).toBeGreaterThan(tasks[0].availableAt! + 12 * 60 * 60000);

    await webhook(harness, message(source, { id: "same-customer", at: Date.now() + 60000 }));
    await processLatestEvent(harness);
    await promoteLatest(harness);
    expect(await harness.run((ctx) => ctx.db.query("followUpTasks").collect())).toHaveLength(2);
  });

  it("uses a safe template fallback and keeps AI failure or unsafe output fail-closed", async () => {
    vi.stubEnv("PHASE3_AI_SUGGESTIONS_ENABLED", "true");
    const harness = createHarness();
    const source = await tenant(harness);
    await harness.run((ctx) => ctx.db.patch(source.businessId, { followUpTemplate: "Hi {name}, available for ₦5,000", followUpAiEnabled: true, responseWindowMinutes: 15 }));
    const opportunity = await createMissedTask(harness, source);
    let [task] = await harness.run((ctx) => ctx.db.query("followUpTasks").collect());
    expect(task.guardrailCode).toBe("PRICE_CLAIM_NOT_ALLOWED");
    expect(task.draftText).not.toContain("5,000");
    await harness.mutation(internal.followUps.applyAiSuggestion, { taskId: task._id, text: "It is available for ₦25,000" });
    task = (await harness.run((ctx) => ctx.db.get(task._id)))!;
    expect(task.aiState).toBe("fallback");
    expect(task.draftSource).toBe("template");
    expect(task.draftText).not.toContain("25,000");
    await harness.mutation(internal.followUps.createTask, { opportunityId: opportunity._id });
    expect(await harness.run((ctx) => ctx.db.query("followUpTasks").collect())).toHaveLength(1);
  });

  it("isolates queue mutations by tenant and purges drafts during customer deletion", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const other = await tenant(harness, "other-seller");
    await createMissedTask(harness, source);
    const [task] = await harness.run((ctx) => ctx.db.query("followUpTasks").collect());
    await expect(other.owner.query(api.followUps.queue, { businessId: source.businessId })).rejects.toThrow("NOT_FOUND");
    await expect(other.owner.mutation(api.followUps.skip, { businessId: other.businessId, taskId: task._id })).rejects.toThrow("NOT_FOUND");
    await source.owner.mutation(api.foundation.deleteCustomer, { businessId: source.businessId, customerId: task.customerId });
    await harness.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await harness.run((ctx) => ctx.db.query("followUpTasks").collect())).toHaveLength(0);
  });

  it("records the Phase 3 migration checkpoint without historical backfill", async () => {
    const harness = createHarness();
    expect(await harness.mutation(internal.migrations.phase3SuggestFirst, { dryRun: true })).toEqual({ complete: true, historicalTasksBackfilled: false });
    await harness.mutation(internal.migrations.phase3SuggestFirst, { dryRun: false });
    expect((await harness.run((ctx) => ctx.db.query("foundationMigrations").withIndex("by_version", (builder) => builder.eq("version", 3)).unique()))?.state).toBe("done");
  });
});
