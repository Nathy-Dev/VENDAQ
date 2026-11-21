export type BillingPlan = "starter" | "growth" | "scale";
export type BillingInterval = "monthly" | "annual";

export const TRIAL_DAYS = 14;
export const TRIAL_ASSISTED_CONVERSATIONS = 100;
export const PAYMENT_GRACE_DAYS = 7;

export const BILLING_PLANS = {
  starter: {
    name: "Starter",
    monthlyAmountKobo: 990_000,
    annualAmountKobo: 9_900_000,
    assistedConversationLimit: 300,
    whatsappNumberLimit: 1,
    enabledGroupLimit: 0,
    automation: false,
  },
  growth: {
    name: "Growth",
    monthlyAmountKobo: 2_490_000,
    annualAmountKobo: 24_900_000,
    assistedConversationLimit: 1_500,
    whatsappNumberLimit: 1,
    enabledGroupLimit: 5,
    automation: true,
  },
  scale: {
    name: "Scale",
    monthlyAmountKobo: 5_990_000,
    annualAmountKobo: 59_900_000,
    assistedConversationLimit: 5_000,
    whatsappNumberLimit: 3,
    enabledGroupLimit: 25,
    automation: true,
  },
} as const;

export function amountFor(plan: BillingPlan, interval: BillingInterval): number {
  return interval === "annual" ? BILLING_PLANS[plan].annualAmountKobo : BILLING_PLANS[plan].monthlyAmountKobo;
}

export function planCodeFor(plan: Exclude<BillingPlan, "scale">, interval: BillingInterval): string {
  const key = `PAYSTACK_PLAN_${plan.toUpperCase()}_${interval.toUpperCase()}`;
  const value = process.env[key];
  if (!value || !/^PLN_[A-Za-z0-9]+$/.test(value)) throw new Error("BILLING_PLAN_NOT_CONFIGURED");
  return value;
}

export function siteUrl(): string {
  const value = process.env.SITE_URL;
  if (!value) throw new Error("SITE_URL_NOT_CONFIGURED");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("INVALID_SITE_URL");
  return parsed.origin;
}

export function monthWindow(at: number): { start: number; end: number } {
  const date = new Date(at);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  return { start, end: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) };
}

function addCalendarMonths(start: number, months: number): number {
  const date = new Date(start);
  const rawMonth = date.getUTCMonth() + months;
  const targetYear = date.getUTCFullYear() + Math.floor(rawMonth / 12);
  const targetMonth = ((rawMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
}

export function periodEndFrom(start: number, interval: BillingInterval): number {
  return addCalendarMonths(start, interval === "annual" ? 12 : 1);
}

export function annualUsageWindow(periodStart: number, at: number): { start: number; end: number } {
  const startDate = new Date(periodStart);
  const atDate = new Date(Math.max(at, periodStart));
  let monthOffset = (atDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + atDate.getUTCMonth() - startDate.getUTCMonth();
  if (addCalendarMonths(periodStart, monthOffset) > at) monthOffset -= 1;
  const start = addCalendarMonths(periodStart, Math.max(0, monthOffset));
  return { start, end: addCalendarMonths(periodStart, Math.max(0, monthOffset) + 1) };
}
