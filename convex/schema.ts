import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  businesses: defineTable({
    name: v.string(),
    ownerId: v.string(), // Clerk user ID or similar
    whatsappMode: v.optional(v.union(v.literal("official"), v.literal("unofficial"))),
    whatsappStatus: v.union(v.literal("disconnected"), v.literal("connected"), v.literal("error"), v.literal("pending")),
    connectionDetails: v.optional(v.any()), // Tokens or Whapi instance details
    qrCode: v.optional(v.string()), // Base64 QR code for Unofficlal mode
    workerSessionId: v.optional(v.string()), // ID of the worker owning this connection
    industry: v.optional(v.string()),
    onboardingStep: v.number(),
  }).index("by_owner", ["ownerId"]),

  customers: defineTable({
    businessId: v.id("businesses"),
    name: v.optional(v.string()),
    phone: v.string(), // International format
    totalValue: v.number(),
    lastInteraction: v.number(),
    tags: v.array(v.string()),
  }).index("by_business_phone", ["businessId", "phone"]),

  orders: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    items: v.array(v.object({
      name: v.string(),
      quantity: v.number(),
      price: v.number(),
    })),
    totalAmount: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("awaiting_payment"),
      v.literal("paid"),
      v.literal("processing"),
      v.literal("shipped"),
      v.literal("delivered"),
      v.literal("cancelled")
    ),
    paymentLink: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_business", ["businessId"])
    .index("by_customer", ["customerId"]),

  inventory: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    description: v.optional(v.string()),
    price: v.number(),
    stockCount: v.number(),
    category: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  }).index("by_business", ["businessId"]),

  interactions: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    role: v.union(v.literal("customer"), v.literal("system"), v.literal("owner")),
    content: v.string(),
    timestamp: v.number(),
    intent: v.optional(v.string()),
  }).index("by_business", ["businessId"])
    .index("by_customer", ["customerId"]),


  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerified: v.optional(v.number()),
    image: v.optional(v.string()),
    password: v.optional(v.string()), // Added for Credentials provider
  }).index("by_email", ["email"]),

  accounts: defineTable({
    userId: v.id("users"),
    type: v.string(),
    provider: v.string(),
    providerAccountId: v.string(),
    refresh_token: v.optional(v.string()),
    access_token: v.optional(v.string()),
    expires_at: v.optional(v.number()),
    token_type: v.optional(v.string()),
    scope: v.optional(v.string()),
    id_token: v.optional(v.string()),
    session_state: v.optional(v.string()),
  })
    .index("by_provider_and_provider_account_id", ["provider", "providerAccountId"])
    .index("by_userId", ["userId"]),

  sessions: defineTable({
    userId: v.id("users"),
    expires: v.number(),
    sessionToken: v.string(),
  })
    .index("by_sessionToken", ["sessionToken"])
    .index("by_userId", ["userId"]),

  verificationTokens: defineTable({
    identifier: v.string(),
    token: v.string(),
    expires: v.number(),
  }).index("by_identifier_and_token", ["identifier", "token"]),
});
