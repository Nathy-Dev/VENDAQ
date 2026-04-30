import { Id } from "../../convex/_generated/dataModel";

export interface Business {
  _id: Id<"businesses">;
  name: string;
  ownerId: string;
  whatsappStatus: "disconnected" | "connected" | "error" | "pending";
  whatsappMode?: "official" | "unofficial";
}

export interface Customer {
  _id: Id<"customers">;
  businessId: Id<"businesses">;
  name?: string;
  phone: string;
  totalValue: number;
  image?: string;
  isGroup?: boolean;
  lastIntent?: string;
  leadSource?: "status_view" | "dm" | "imported";
  funnelStage?: "viewer" | "engaged" | "intent" | "order_created" | "awaiting_payment" | "paid" | "lost";
  lastStatusViewedAt?: number;
  lastOutboundAt?: number;
  lastInboundAt?: number;
}

export interface Interaction {
  _id: Id<"interactions">;
  businessId: Id<"businesses">;
  customerId: Id<"customers">;
  role: "customer" | "system" | "owner";
  content: string;
  timestamp: number;
  messageType?: "text" | "image" | "video" | "audio" | "document" | "location";
  mediaId?: string;
  fileName?: string;
}

export interface Order {
  _id: Id<"orders">;
  businessId: Id<"businesses">;
  customerId: Id<"customers">;
  customerName?: string;
  customerPhone: string;
  totalAmount: number;
  status: "pending" | "awaiting_payment" | "paid" | "payment_failed" | "expired" | "processing" | "shipped" | "delivered" | "cancelled";
  createdAt: number;
}

export interface ChatThread extends Customer {
  lastMessage: string;
  lastMessageTimestamp: number;
  lastMessageType?: string;
  lastMediaId?: string;
  lastIntent?: string;
}

export interface PooledOrders {
  pending: Order[];
  awaiting_payment: Order[];
  processing: Order[];
  delivered: Order[];
}

export interface InvisibleCrmOverview {
  hotLeads: number;
  stalledAfterQuote: number;
  unattendedHotLeads: number;
  potentialRevenueAtRisk: number;
}

export interface RevenueActionItem {
  customerId: Id<"customers">;
  customerName: string;
  customerPhone: string;
  priority: "high" | "medium" | "low";
  reason: string;
  suggestedMessage: string;
  dueAt: number;
  estimatedValue: number;
}

export interface ActionOutcome {
  _id: Id<"actionOutcomes">;
  customerId: Id<"customers">;
  customerName: string;
  status: "sent" | "replied" | "won" | "lost";
  suggestedMessage: string;
  estimatedValue: number;
  sentAt: number;
  repliedAt?: number;
  closedAt?: number;
  outcomeValue?: number;
}

export interface RevenueLoopMetrics {
  totalSent: number;
  replyRate: number;
  winRate: number;
  recoveredRevenue: number;
}
