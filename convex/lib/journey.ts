import type { MessageClass } from "./classifier";

export const JOURNEY_STAGES = ["viewer", "engaged", "intent", "order_created", "awaiting_payment", "paid", "lost"] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

const LEGAL_TRANSITIONS: Record<JourneyStage, readonly JourneyStage[]> = {
  viewer: ["engaged", "lost"],
  engaged: ["intent", "lost"],
  intent: ["order_created", "lost"],
  order_created: ["awaiting_payment", "lost"],
  awaiting_payment: ["paid", "lost"],
  paid: [],
  lost: ["engaged"],
};

// Same-state updates are harmless no-ops; every actual state change must be in
// the explicit graph so later features cannot silently skip journey evidence.
export function canTransitionJourney(from: JourneyStage, to: JourneyStage): boolean {
  return from === to || LEGAL_TRANSITIONS[from].includes(to);
}

export function transitionJourney(from: JourneyStage, to: JourneyStage): JourneyStage {
  if (!canTransitionJourney(from, to)) throw new Error(`ILLEGAL_JOURNEY_TRANSITION:${from}:${to}`);
  return to;
}

// Inbound text can establish engagement and buying intent, but payment words
// never prove that money was received. Paid remains an explicit seller outcome.
export function journeyAfterInbound(current: JourneyStage, classification: MessageClass): JourneyStage {
  if (current === "paid") return current;
  if (current === "viewer" || current === "lost") {
    const engaged = transitionJourney(current, "engaged");
    return classification === "buying_signal" ? transitionJourney(engaged, "intent") : engaged;
  }
  if (classification === "buying_signal" && current === "engaged") return transitionJourney(current, "intent");
  return current;
}
