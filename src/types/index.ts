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
}

export interface Interaction {
  _id: Id<"interactions">;
  businessId: Id<"businesses">;
  customerId: Id<"customers">;
  role: "customer" | "system" | "owner";
  content: string;
  timestamp: number;
}

export interface Order {
  _id: Id<"orders">;
  businessId: Id<"businesses">;
  customerId: Id<"customers">;
  totalAmount: number;
  status: "pending" | "awaiting_payment" | "processing" | "shipped" | "delivered" | "cancelled";
  createdAt: number;
}

export interface ChatThread extends Customer {
  lastMessage: string;
  lastMessageTimestamp: number;
}

export interface PooledOrders {
  pending: Order[];
  awaiting_payment: Order[];
  processing: Order[];
  delivered: Order[];
}
