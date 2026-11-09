import { foundationPolicy } from "./policy";

export const SUGGESTION_VERSION = "suggestion-v1";
export const DEFAULT_FOLLOW_UP_TEMPLATE = "Hi {name}, thanks for your message. I saw your interest and wanted to check whether you still need help with this.";

export type SuggestionPolicy = {
  cooldownMinutes: number;
  dailyCap: number;
  workHoursEnabled: boolean;
  workHoursStart: number;
  workHoursEnd: number;
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function localParts(timestamp: number, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

function timezoneOffset(timestamp: number, timezone: string): number {
  const parts = localParts(timestamp, timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(timestamp / 60000) * 60000;
}

function localTimeToUtc(parts: LocalParts, timezone: string): number {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let timestamp = guess - timezoneOffset(guess, timezone);
  timestamp = guess - timezoneOffset(timestamp, timezone);
  return timestamp;
}

export function localDayBounds(timestamp: number, timezone: string): { start: number; end: number } {
  const parts = localParts(timestamp, timezone);
  const start = localTimeToUtc({ ...parts, hour: 0, minute: 0 }, timezone);
  const nextDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const end = localTimeToUtc({ year: nextDate.getUTCFullYear(), month: nextDate.getUTCMonth() + 1, day: nextDate.getUTCDate(), hour: 0, minute: 0 }, timezone);
  return { start, end };
}

function insideWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return true;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function isSuggestionTimeAllowed(timestamp: number, timezone: string, policy: SuggestionPolicy): boolean {
  const parts = localParts(timestamp, timezone);
  const minute = parts.hour * 60 + parts.minute;
  if (policy.workHoursEnabled && policy.workHoursStart !== policy.workHoursEnd && !insideWindow(minute, policy.workHoursStart, policy.workHoursEnd)) return false;
  if (policy.quietHoursEnabled && policy.quietHoursStart !== policy.quietHoursEnd && insideWindow(minute, policy.quietHoursStart, policy.quietHoursEnd)) return false;
  return true;
}

// Search minute boundaries rather than assuming a fixed UTC offset; this keeps
// configured timezones correct across offset changes without a timezone library.
export function nextAllowedSuggestionAt(timestamp: number, timezone: string, policy: SuggestionPolicy): number {
  let candidate = Math.ceil(timestamp / 60000) * 60000;
  for (let minute = 0; minute < 8 * 24 * 60; minute += 1, candidate += 60000) {
    if (isSuggestionTimeAllowed(candidate, timezone, policy)) return candidate;
  }
  throw new Error("NO_SUGGESTION_WINDOW");
}

function safeName(name: string | undefined): string {
  const normalized = name?.replace(/[{}[\]\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= 80 ? normalized : "there";
}

export function validateSuggestion(text: string): { safe: boolean; code: string | null } {
  const normalized = text.trim();
  if (normalized.length < 10 || normalized.length > foundationPolicy().suggestionMaxLength) return { safe: false, code: "INVALID_LENGTH" };
  if (/https?:\/\/|www\.|wa\.me/i.test(normalized)) return { safe: false, code: "URL_NOT_ALLOWED" };
  if (/[₦$£€]|\b(?:ngn|naira|dollars?|price|costs?)\b/i.test(normalized)) return { safe: false, code: "PRICE_CLAIM_NOT_ALLOWED" };
  if (/\b(?:discount|promo(?:tion)?|coupon|percent\s+off)\b|\d+\s*%/i.test(normalized)) return { safe: false, code: "DISCOUNT_NOT_ALLOWED" };
  if (/\b(?:in stock|out of stock|available|availability|only \d+ left)\b/i.test(normalized)) return { safe: false, code: "AVAILABILITY_NOT_ALLOWED" };
  if (/\b(?:account number|bank details?|payment link|paystack|flutterwave|transfer to)\b/i.test(normalized)) return { safe: false, code: "PAYMENT_DETAIL_NOT_ALLOWED" };
  if (/[{}]|\[[^\]]+\]/.test(normalized)) return { safe: false, code: "UNKNOWN_PLACEHOLDER" };
  return { safe: true, code: null };
}

export function renderSafeSuggestion(template: string | undefined, customerName: string | undefined): { text: string; fallback: boolean; validationCode: string | null } {
  const render = (value: string) => value.replaceAll("{name}", safeName(customerName)).replaceAll("[Customer Name]", safeName(customerName)).trim();
  const candidate = render(template?.trim() || DEFAULT_FOLLOW_UP_TEMPLATE);
  const validation = validateSuggestion(candidate);
  if (validation.safe) return { text: candidate, fallback: false, validationCode: null };
  const fallback = render(DEFAULT_FOLLOW_UP_TEMPLATE);
  return { text: fallback, fallback: true, validationCode: validation.code };
}
