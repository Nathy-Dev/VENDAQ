import { ConvexError } from "convex/values";

export const PHASE = 6;
export const DISCLOSURE_VERSION = "phase-1-2026-10-27";

export function setting(name: string, fallback: number, minimum = 1, maximum = 1_000_000_000): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ConvexError({ code: "INVALID_CONFIGURATION", setting: name });
  }
  return value;
}

export function foundationPolicy() {
  return {
    maxWebhookBytes: setting("FOUNDATION_MAX_WEBHOOK_BYTES", 262144, 1024, 1048576),
    maxTextLength: setting("FOUNDATION_MAX_TEXT_LENGTH", 16000, 100, 64000),
    retryAttempts: setting("FOUNDATION_RETRY_ATTEMPTS", 5, 1, 10),
    retryBaseMs: setting("FOUNDATION_RETRY_BASE_MS", 2000, 100, 60000),
    leaseMs: setting("FOUNDATION_JOB_LEASE_MS", 60000, 1000, 300000),
    batchSize: setting("FOUNDATION_BATCH_SIZE", 50, 1, 100),
    messageRetentionDays: setting("FOUNDATION_MESSAGE_RETENTION_DAYS", 90, 1, 365),
    eventRetentionDays: setting("FOUNDATION_EVENT_RETENTION_DAYS", 7, 1, 30),
    qrLifetimeMs: setting("FOUNDATION_QR_LIFETIME_MS", 120000, 1000, 300000),
    providerTimeoutMs: setting("FOUNDATION_PROVIDER_TIMEOUT_MS", 10000, 1000, 25000),
    healthIntervalMs: setting("FOUNDATION_HEALTH_INTERVAL_MS", 300000, 60000, 3600000),
    authWindowMs: setting("FOUNDATION_AUTH_WINDOW_MS", 900000, 60000, 3600000),
    authAccountLimit: setting("FOUNDATION_AUTH_ACCOUNT_LIMIT", 10, 1, 100),
    authGlobalLimit: setting("FOUNDATION_AUTH_GLOBAL_LIMIT", 200, 10, 10000),
    responseWindowMinutes: setting("PHASE2_RESPONSE_WINDOW_MINUTES", 120, 15, 1440),
    followUpCooldownMinutes: setting("PHASE3_COOLDOWN_MINUTES", 1440, 15, 43200),
    dailySuggestionCap: setting("PHASE3_DAILY_SUGGESTION_CAP", 20, 1, 100),
    workHoursStart: setting("PHASE3_WORK_HOURS_START", 540, 0, 1439),
    workHoursEnd: setting("PHASE3_WORK_HOURS_END", 1260, 0, 1439),
    quietHoursStart: setting("PHASE3_QUIET_HOURS_START", 1260, 0, 1439),
    quietHoursEnd: setting("PHASE3_QUIET_HOURS_END", 480, 0, 1439),
    suggestionMaxLength: setting("PHASE3_SUGGESTION_MAX_LENGTH", 500, 80, 1000),
    aiSuggestionTimeoutMs: setting("PHASE3_AI_TIMEOUT_MS", 8000, 1000, 25000),
    stalledOpportunityMinutes: setting("PHASE4_STALLED_OPPORTUNITY_MINUTES", 360, 30, 10080),
    paymentReminderMinutes: setting("PHASE4_PAYMENT_REMINDER_MINUTES", 1440, 30, 43200),
    attributionWindowDays: setting("PHASE5_ATTRIBUTION_WINDOW_DAYS", 7, 1, 30),
    dashboardRecordLimit: setting("PHASE5_DASHBOARD_RECORD_LIMIT", 1000, 100, 5000),
    riskWindowHours: setting("PHASE6_RISK_WINDOW_HOURS", 24, 1, 168),
    riskWarningCount: setting("PHASE6_RISK_WARNING_COUNT", 5, 1, 1000),
  };
}

export function blockLegacyOperation(): void {
  throw new ConvexError({ code: "PHASE_DISABLED", message: "This legacy operation is disabled outside the approved Phase 6 manual-first boundary." });
}

export function assertNoOutbound(operation: string): void {
  throw new ConvexError({ code: "OUTBOUND_DISABLED", operation, phase: PHASE });
}

export function logEvent(event: string, metadata: {
  correlationId: string;
  businessId?: string;
  eventId?: string;
  attempt?: number;
  code?: string;
}) {
  console.info(JSON.stringify({ event, phase: PHASE, ...metadata }));
}
