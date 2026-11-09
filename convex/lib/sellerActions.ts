import type { JourneyStage } from "./journey";

export type OrderStatus = "pending" | "awaiting_payment" | "paid" | "payment_failed" | "expired" | "processing" | "shipped" | "delivered" | "cancelled";

const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["awaiting_payment", "paid", "cancelled"],
  awaiting_payment: ["paid", "payment_failed", "expired", "cancelled"],
  paid: ["processing", "cancelled"],
  payment_failed: ["awaiting_payment", "cancelled"],
  expired: ["awaiting_payment", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || ORDER_TRANSITIONS[from].includes(to);
}

export function transitionOrder(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (!canTransitionOrder(from, to)) throw new Error(`ILLEGAL_ORDER_TRANSITION:${from}:${to}`);
  return to;
}

// Explicit seller order actions may supply the missing intent evidence, but the
// stored journey still advances through every legal state instead of skipping.
export function journeyForOrder(current: JourneyStage, status: OrderStatus): JourneyStage {
  if (current === "paid") return current;
  let stage: JourneyStage = current;
  if (stage === "viewer" || stage === "lost") stage = "engaged";
  if (stage === "engaged") stage = "intent";
  if (stage === "intent") stage = "order_created";
  if (status === "awaiting_payment" && stage === "order_created") stage = "awaiting_payment";
  if (status === "paid") {
    if (stage === "order_created") stage = "awaiting_payment";
    if (stage === "awaiting_payment") stage = "paid";
  }
  return stage;
}

export function actionPriority(reason: "buying_signal" | "asked_no_order" | "awaiting_payment", availableAt: number, now: number): number {
  const reasonWeight = reason === "awaiting_payment" ? 300 : reason === "buying_signal" ? 200 : 100;
  const overdueHours = Math.max(0, Math.floor((now - availableAt) / 3600000));
  return reasonWeight + Math.min(overdueHours, 99);
}
