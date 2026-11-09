import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { foundationPolicy } from "./lib/policy";

export const foundationV1 = internalMutation({
  args: { dryRun: v.boolean(), cursor: v.optional(v.string()), scrubLegacyCredentials: v.optional(v.boolean()) },
  returns: v.object({ processed: v.number(), complete: v.boolean(), cursor: v.union(v.string(), v.null()), dryRun: v.boolean() }),
  handler: async (ctx, args) => {
    const progress = await ctx.db.query("foundationMigrations").withIndex("by_version", (builder) => builder.eq("version", 1)).unique();
    // Replayed pages cannot double-count or restart a completed migration.
    if (!args.dryRun && progress?.state === "done") return { processed: 0, complete: true, cursor: null, dryRun: false };
    if (!args.dryRun && progress && args.cursor !== progress.cursor) throw new ConvexError({ code: "MIGRATION_CURSOR_MISMATCH" });
    const page = await ctx.db.query("businesses").withIndex("by_owner").paginate({ cursor: args.cursor ?? null, numItems: foundationPolicy().batchSize });
    if (!args.dryRun) {
      for (const business of page.page) {
        if (business.foundationVersion === 1) continue;
        // Preserve existing development data by default. Credential erasure is a
        // separate explicit operator choice after export/revocation is verified.
        await ctx.db.patch(business._id, { foundationVersion: 0, killSwitch: true, aiEnabled: false, ...(args.scrubLegacyCredentials ? { connectionDetails: undefined, qrCode: undefined, pairingCode: undefined } : {}) });
      }
      const update = { version: 1, state: page.isDone ? "done" as const : "running" as const, processed: (progress?.processed ?? 0) + page.page.length, updatedAt: Date.now(), ...(page.isDone ? { cursor: undefined } : { cursor: page.continueCursor }) };
      if (progress) await ctx.db.patch(progress._id, update);
      else await ctx.db.insert("foundationMigrations", update);
    }
    return { processed: page.page.length, complete: page.isDone, cursor: page.isDone ? null : page.continueCursor, dryRun: args.dryRun };
  },
});

export const cancelLegacyTasks = internalMutation({
  args: { dryRun: v.boolean() }, returns: v.object({ count: v.number(), more: v.boolean() }),
  handler: async (ctx, args) => {
    const tasks = await ctx.db.query("followUpTasks").withIndex("by_status", (builder) => builder.eq("status", "pending")).take(foundationPolicy().batchSize);
    if (!args.dryRun) for (const task of tasks) {
      const scheduledId = task.scheduledFunctionId ? ctx.db.system.normalizeId("_scheduled_functions", task.scheduledFunctionId) : null;
      const scheduled = scheduledId ? await ctx.db.system.get(scheduledId) : null;
      if (scheduledId && scheduled?.state.kind === "pending") await ctx.scheduler.cancel(scheduledId);
      await ctx.db.patch(task._id, { status: "cancelled" });
    }
    return { count: tasks.length, more: tasks.length === foundationPolicy().batchSize };
  },
});

export const phase2ReadOnly = internalMutation({
  args: { dryRun: v.boolean() }, returns: v.object({ complete: v.boolean(), historicalInteractionsBackfilled: v.boolean() }),
  handler: async (ctx, args) => {
    const progress = await ctx.db.query("foundationMigrations").withIndex("by_version", (builder) => builder.eq("version", 2)).unique();
    if (!args.dryRun && !progress) await ctx.db.insert("foundationMigrations", { version: 2, state: "done", processed: 0, updatedAt: Date.now() });
    // Historical conversations are intentionally not classified into the live
    // report because that would create unaudited missed-opportunity claims.
    return { complete: true, historicalInteractionsBackfilled: false };
  },
});

export const phase3SuggestFirst = internalMutation({
  args: { dryRun: v.boolean() }, returns: v.object({ complete: v.boolean(), historicalTasksBackfilled: v.boolean() }),
  handler: async (ctx, args) => {
    const progress = await ctx.db.query("foundationMigrations").withIndex("by_version", (builder) => builder.eq("version", 3)).unique();
    if (!args.dryRun && !progress) await ctx.db.insert("foundationMigrations", { version: 3, state: "done", processed: 0, updatedAt: Date.now() });
    // Only opportunities promoted after this checkpoint create suggestions; old
    // evidence is not converted into unexpected seller actions.
    return { complete: true, historicalTasksBackfilled: false };
  },
});

function checkpoint(version: number, historicalBackfillKey: string) {
  return internalMutation({
    args: { dryRun: v.boolean() },
    returns: v.object({ complete: v.boolean(), historicalBackfill: v.boolean(), checkpoint: v.string() }),
    handler: async (ctx, args) => {
      const progress = await ctx.db.query("foundationMigrations").withIndex("by_version", (builder) => builder.eq("version", version)).unique();
      if (!args.dryRun && !progress) await ctx.db.insert("foundationMigrations", { version, state: "done", processed: 0, updatedAt: Date.now() });
      return { complete: true, historicalBackfill: false, checkpoint: historicalBackfillKey };
    },
  });
}

// Historical seller actions cannot be inferred safely from conversations.
export const phase4SellerActions = checkpoint(4, "seller_actions");
// Historical revenue is not attributed without contemporaneous action evidence.
export const phase5Measurement = checkpoint(5, "revenue_attribution");
// Existing Status observations remain opaque and create no customer records.
export const phase6Extensions = checkpoint(6, "status_and_risk");
