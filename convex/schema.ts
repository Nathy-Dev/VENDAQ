import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  businesses: defineTable({
    name: v.string(),
    ownerId: v.string(), // Clerk user ID or similar
    assistantAdminPhones: v.optional(v.array(v.string())),
    whatsappMode: v.optional(v.union(v.literal("official"), v.literal("unofficial"))),
    whatsappStatus: v.union(v.literal("disconnected"), v.literal("connected"), v.literal("error"), v.literal("pending")),
    connectionDetails: v.optional(v.any()), // Tokens or Whapi instance details
    qrCode: v.optional(v.string()), // Base64 QR code for Unofficlal mode
    pairingCode: v.optional(v.string()), // 8-char code for link-by-phone
    workerSessionId: v.optional(v.string()), // ID of the worker owning this connection
    lastHistorySyncAt: v.optional(v.number()),
    lastHistorySyncCount: v.optional(v.number()),
    lastHistorySyncWindowHours: v.optional(v.number()),
    industry: v.optional(v.string()),
    onboardingStep: v.number(),
    // Evolution Go integration
    evolutionInstanceName: v.optional(v.string()),
    evolutionInstanceId: v.optional(v.string()),
    // Automation configuration
    averageOrderValue: v.optional(v.number()),
    responseWindowMinutes: v.optional(v.number()),
    followUpTemplate: v.optional(v.string()),
  }).index("by_owner", ["ownerId"]),

  customers: defineTable({
    businessId: v.id("businesses"),
    name: v.optional(v.string()),
    phone: v.string(), // International format or Group JID
    isGroup: v.optional(v.boolean()),
    groupMetadata: v.optional(v.object({
      owner: v.optional(v.string()),
      participants: v.array(v.string()),
    })),
    totalValue: v.number(),
    lastInteraction: v.number(),
    lastIntent: v.optional(v.string()), // Added for Status-to-Cash Engine
    leadSource: v.optional(v.union(v.literal("status_view"), v.literal("dm"), v.literal("imported"))),
    funnelStage: v.optional(v.union(
      v.literal("viewer"),
      v.literal("engaged"),
      v.literal("intent"),
      v.literal("order_created"),
      v.literal("awaiting_payment"),
      v.literal("paid"),
      v.literal("lost")
    )),
    lastStatusViewedAt: v.optional(v.number()),
    lastOutboundAt: v.optional(v.number()),
    lastInboundAt: v.optional(v.number()),
    memoryLastAskedTopic: v.optional(v.string()),
    memoryPreferredCategory: v.optional(v.string()),
    memoryLastObjection: v.optional(v.string()),
    memoryIgnoredOffers: v.optional(v.array(v.string())),
    memorySummaryUpdatedAt: v.optional(v.number()),
    tags: v.array(v.string()),
  }).index("by_business_phone", ["businessId", "phone"])
    .index("by_business_last_interaction", ["businessId", "lastInteraction"])
    .index("by_business_funnel_stage", ["businessId", "funnelStage"]),

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
      v.literal("payment_failed"),
      v.literal("expired"),
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
    // Media support
    messageType: v.optional(v.union(v.literal("text"), v.literal("image"), v.literal("video"), v.literal("audio"), v.literal("document"), v.literal("location"))),
    mediaUrl: v.optional(v.string()),
    mediaId: v.optional(v.string()), // Convex storage ID
    fileName: v.optional(v.string()),
    whatsappMessageId: v.optional(v.string()), // Unique ID from Baileys
    isEdited: v.optional(v.boolean()),
  }).index("by_business", ["businessId"])
    .index("by_customer", ["customerId"])
    .index("by_whatsapp_id", ["whatsappMessageId"]),

  statuses: defineTable({
    businessId: v.id("businesses"),
    sender: v.string(),
    content: v.optional(v.string()),
    mediaId: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    timestamp: v.number(),
    expiresAt: v.number(),
    whatsappMessageId: v.optional(v.string()),
  }).index("by_business", ["businessId"])
    .index("by_whatsapp_id", ["whatsappMessageId"]),

  statusViews: defineTable({
    businessId: v.id("businesses"),
    statusId: v.optional(v.id("statuses")), // Can be empty if we don't have the status synced yet
    whatsappStatusId: v.string(),
    viewerPhone: v.string(),
    timestamp: v.number(),
  }).index("by_business", ["businessId"])
    .index("by_status", ["whatsappStatusId"]),

  automations: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    ruleType: v.union(
      v.literal("viewed_no_dm"),
      v.literal("asked_no_order"),
      v.literal("awaiting_payment"),
      v.literal("reopen_conversation")
    ),
    audienceCriteria: v.any(),
    templateId: v.id("messageTemplates"),
    cooldownMinutes: v.number(),
    quietHoursStart: v.optional(v.number()),
    quietHoursEnd: v.optional(v.number()),
    perContactDailyCap: v.optional(v.number()),
    dailySendCap: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_business", ["businessId"]),

  followUpTasks: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    reason: v.union(
      v.literal("buying_signal"),
      v.literal("viewed_no_dm"),
      v.literal("asked_no_order"),
      v.literal("awaiting_payment")
    ),
    dueAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("skipped"), v.literal("cancelled")),
    scheduledFunctionId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_business_due", ["businessId", "dueAt"])
    .index("by_customer_reason", ["customerId", "reason"]),

  messageTemplates: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    type: v.union(
      v.literal("price_list"),
      v.literal("checkout"),
      v.literal("payment_reminder"),
      v.literal("reopen_conversation")
    ),
    body: v.string(),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_business", ["businessId"])
    .index("by_business_type", ["businessId", "type"]),

  automationRuns: defineTable({
    businessId: v.id("businesses"),
    automationId: v.optional(v.id("automations")),
    segment: v.string(),
    templateId: v.id("messageTemplates"),
    mode: v.union(v.literal("manual"), v.literal("scheduled")),
    scheduledAt: v.optional(v.number()),
    executedAt: v.optional(v.number()),
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    sentCount: v.number(),
    createdAt: v.number(),
  }).index("by_business_status", ["businessId", "status"])
    .index("by_scheduled_status", ["status", "scheduledAt"]),

  actionOutcomes: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    status: v.union(v.literal("sent"), v.literal("replied"), v.literal("won"), v.literal("lost")),
    actionType: v.string(),
    suggestedMessage: v.string(),
    initialIntent: v.optional(v.string()),
    scoreAtSend: v.number(),
    estimatedValue: v.number(),
    sentAt: v.number(),
    repliedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    outcomeValue: v.optional(v.number()),
  }).index("by_business_sent", ["businessId", "sentAt"])
    .index("by_customer_status", ["customerId", "status"]),


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
