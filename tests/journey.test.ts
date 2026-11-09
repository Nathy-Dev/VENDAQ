import { describe, expect, it } from "vitest";
import { canTransitionJourney, journeyAfterInbound, transitionJourney } from "../convex/lib/journey";
import { DEFAULT_FOLLOW_UP_TEMPLATE, isSuggestionTimeAllowed, nextAllowedSuggestionAt, renderSafeSuggestion, validateSuggestion } from "../convex/lib/suggestions";

describe("Phase 3 journey and suggestion rules", () => {
  it("allows only explicit journey transitions and never infers paid from payment text", () => {
    expect(canTransitionJourney("viewer", "engaged")).toBe(true);
    expect(canTransitionJourney("engaged", "intent")).toBe(true);
    expect(canTransitionJourney("intent", "paid")).toBe(false);
    expect(canTransitionJourney("paid", "engaged")).toBe(false);
    expect(() => transitionJourney("engaged", "paid")).toThrow("ILLEGAL_JOURNEY_TRANSITION");
    expect(journeyAfterInbound("engaged", "buying_signal")).toBe("intent");
    expect(journeyAfterInbound("awaiting_payment", "payment_related")).toBe("awaiting_payment");
    expect(journeyAfterInbound("lost", "inquiry")).toBe("engaged");
  });

  it("defers suggestions outside work and quiet hours", () => {
    const policy = { cooldownMinutes: 1440, dailyCap: 20, workHoursEnabled: true, workHoursStart: 9 * 60, workHoursEnd: 21 * 60, quietHoursEnabled: true, quietHoursStart: 21 * 60, quietHoursEnd: 8 * 60 };
    const beforeWork = Date.parse("2026-10-27T06:00:00.000Z"); // 07:00 in Lagos.
    expect(isSuggestionTimeAllowed(beforeWork, "Africa/Lagos", policy)).toBe(false);
    expect(new Date(nextAllowedSuggestionAt(beforeWork, "Africa/Lagos", policy)).toISOString()).toBe("2026-10-27T08:00:00.000Z");
    expect(isSuggestionTimeAllowed(Date.parse("2026-10-27T12:00:00.000Z"), "Africa/Lagos", policy)).toBe(true);
  });

  it.each([
    "The price is ₦25,000",
    "It is available in stock",
    "I can give you 10% discount",
    "Pay to account number 1234",
    "Use https://pay.example.test",
  ])("rejects unsafe suggestion content: %s", (text) => {
    expect(validateSuggestion(text).safe).toBe(false);
  });

  it("renders the supported name placeholder and falls back from unsafe templates", () => {
    expect(renderSafeSuggestion("Hello {name}, do you still need help?", "Ada")).toMatchObject({ text: "Hello Ada, do you still need help?", fallback: false });
    const result = renderSafeSuggestion("Hi {name}, it is available for ₦5,000", "Ada");
    expect(result.fallback).toBe(true);
    expect(result.text).toBe(DEFAULT_FOLLOW_UP_TEMPLATE.replace("{name}", "Ada"));
    expect(validateSuggestion(result.text).safe).toBe(true);
  });
});
