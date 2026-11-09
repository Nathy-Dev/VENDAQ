import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ── Daily at 1:00 AM WAT (midnight UTC) ──
// Captures yesterday's metrics snapshot + tags lost opportunities
crons.daily(
  "daily-maintenance",
  { hourUTC: 0, minuteUTC: 0 },
  internal.pipeline.runDailyMaintenance
);

// ── Every 2 hours ──
// Detects engaged customers who asked but never ordered
crons.interval(
  "asked-no-order-scan",
  { hours: 2 },
  internal.pipeline.runAskedNoOrderScan
);

// ── Every hour ──
// Processes due payment reminders
crons.interval(
  "payment-follow-ups",
  { hours: 1 },
  internal.pipeline.runPaymentFollowUps
);

// ── Every 30 minutes ──
// Runs scheduled automation campaigns
crons.interval(
  "scheduled-automations",
  { minutes: 30 },
  internal.pipeline.runScheduledAutomations
);

// Keep the original schedules for later phases without registering them.
const foundationCrons = cronJobs();
foundationCrons.interval("foundation-maintenance", { minutes: 1 }, internal.maintenance.sweep, {});
export default foundationCrons;
