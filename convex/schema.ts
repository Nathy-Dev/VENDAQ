
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { eventFields, sessionFields } from "./lib/validators";

export default defineSchema({
  businesses: defineTable({
    foundationVersion: v.optional(v.number()),
    timezone: v.optional(v.string()),
    killSwitch: v.optional(v.boolean()),
    messageRetentionDays: v.optional(v.number()),
    disclosureVersion: v.optional(v.string()),
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
    followUpCooldownMinutes: v.optional(v.number()),
    dailySuggestionCap: v.optional(v.number()),
    followUpWorkHoursEnabled: v.optional(v.boolean()),
    followUpWorkHoursStart: v.optional(v.number()),
    followUpWorkHoursEnd: v.optional(v.number()),
    followUpQuietHoursEnabled: v.optional(v.boolean()),
    followUpQuietHoursStart: v.optional(v.number()),
    followUpQuietHoursEnd: v.optional(v.number()),
    followUpAiEnabled: v.optional(v.boolean()),
    stalledOpportunityMinutes: v.optional(v.number()),
    paymentReminderMinutes: v.optional(v.number()),
    attributionWindowDays: v.optional(v.number()),
    statusViewerListEnabled: v.optional(v.boolean()),
    automatedSendingRequested: v.optional(v.boolean()),
    // First-launch assistant controls. These are separate from the legacy
    // automation fields so consent is explicit and can be revoked instantly.
    customerAutoReplyEnabled: v.optional(v.boolean()),
    groupAutoReplyEnabled: v.optional(v.boolean()),
    assistantConsentAt: v.optional(v.number()),
    businessSystemPrompt: v.optional(v.string()),
    businessSystemPromptUpdatedAt: v.optional(v.number()),
    businessSystemPromptGeneratedAt: v.optional(v.number()),
    leadQualificationEnabled: v.optional(v.boolean()),
    leadQualificationCriteria: v.optional(v.string()),
    leadQualificationRequiredFields: v.optional(v.array(v.union(
      v.literal("need"),
      v.literal("budget"),
      v.literal("location"),
      v.literal("timeline"),
      v.literal("readiness"),
    ))),
    lastDirectorySyncAt: v.optional(v.number()),
    // Status-to-Cash: template used when nudging a status viewer who never DMs.
    // Supports the placeholder [Customer Name].
    viewedNoDmTemplate: v.optional(v.string()),
    // AI configuration
    aiEnabled: v.optional(v.boolean()), // Default true — toggle AI processing
    // Deprecated: model selection is now deployment-level via Convex env vars.
    aiLlmModel: v.optional(v.string()),
    aiVisionModel: v.optional(v.string()),

    // ── AI Behaviour (owner-facing, plain-language settings) ──
    // "How should the assistant sound?"
    aiTone: v.optional(v.union(
      v.literal("friendly"),
      v.literal("professional"),
      v.literal("playful"),
    )),
    aiLanguageStyle: v.optional(v.union(
      v.literal("english"),
      v.literal("pidgin"),
      v.literal("mixed"),
    )),
    aiBusinessContext: v.optional(v.string()), // one-liner about the business (max ~300 chars)

    // "When should the assistant reply?"
    aiWorkHoursEnabled: v.optional(v.boolean()),
    aiWorkHoursStart: v.optional(v.number()), // minutes-since-midnight, e.g. 9*60 = 540
    aiWorkHoursEnd: v.optional(v.number()),   // e.g. 21*60 = 1260

    // "What should the assistant never do?" (guardrails)
    aiNeverQuotePrice: v.optional(v.boolean()),
    aiNeverSendPaymentLink: v.optional(v.boolean()),
    aiNeverOfferDiscount: v.optional(v.boolean()),
  }).index("by_owner", ["ownerId"])
    .index("by_whatsapp_status", ["whatsappStatus"]),


  customers: defineTable({
    identityKey: v.optional(v.string()),
    firstInboundAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
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
    .index("by_business_funnel_stage", ["businessId", "funnelStage"])
    .index("by_expiry", ["expiresAt"])
    .index("by_business_identity", ["businessId", "identityKey"]),

  contactAliases: defineTable({
    businessId: v.id("businesses"),
    jid: v.string(),
    canonicalJid: v.string(),
    canonicalIdentityKey: v.optional(v.string()),
    name: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_business_jid", ["businessId", "jid"])
    .index("by_business_canonical", ["businessId", "canonicalJid"]),

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
    updatedAt: v.optional(v.number()),
    sourceTaskId: v.optional(v.id("followUpTasks")),
    sourceOpportunityId: v.optional(v.id("communityOpportunities")),
    sourceGroupJid: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    lostAt: v.optional(v.number()),
  }).index("by_business", ["businessId"])
    .index("by_customer", ["customerId"])
    .index("by_source_task", ["sourceTaskId"])
    .index("by_source_opportunity", ["sourceOpportunityId"]),

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
    conversationId: v.optional(v.id("conversations")),
    sessionId: v.optional(v.id("whatsappSessions")),
    providerEventKey: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    manualReviewRequired: v.optional(v.boolean()),
    isGroup: v.optional(v.boolean()),
    wasMentioned: v.optional(v.boolean()),
    participantJid: v.optional(v.string()),
    participantName: v.optional(v.string()),
    classifierLabel: v.optional(v.union(v.literal("buying_signal"), v.literal("inquiry"), v.literal("payment_related"), v.literal("casual_noise"), v.literal("manual_review"))),
    classifierVersion: v.optional(v.string()),
    classifierConfidence: v.optional(v.number()),
    classifierRuleIds: v.optional(v.array(v.string())),
    classifiedAt: v.optional(v.number()),
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    role: v.union(v.literal("customer"), v.literal("system"), v.literal("owner")),
    content: v.string(),
    timestamp: v.number(),
    intent: v.optional(v.string()),
    // AI classification
    aiClassification: v.optional(v.string()), // AI-determined intent (may differ from keyword)
    aiConfidence: v.optional(v.number()), // 0-1 confidence score from AI
    aiReasoning: v.optional(v.string()), // Brief explanation of why AI classified this way
    imageAnalysis: v.optional(v.string()), // AI vision analysis of attached image
    imageAnalysisState: v.optional(v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))),
    imageAnalysisErrorCode: v.optional(v.string()),
    aiProcessedAt: v.optional(v.number()), // Timestamp when AI processed this message
    // Media support
    messageType: v.optional(v.union(v.literal("text"), v.literal("image"), v.literal("video"), v.literal("audio"), v.literal("document"), v.literal("location"))),
    mediaUrl: v.optional(v.string()),
    mediaId: v.optional(v.string()), // Convex storage ID
    fileName: v.optional(v.string()),
    matchedKeywords: v.optional(v.array(v.string())), // Keywords that triggered the classification
    whatsappMessageId: v.optional(v.string()), // Unique ID from Baileys
    isEdited: v.optional(v.boolean()),
    transcriptionState: v.optional(v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))),
    transcript: v.optional(v.string()),
    transcriptLanguage: v.optional(v.string()),
    transcriptConfidence: v.optional(v.number()),
    transcribedAt: v.optional(v.number()),
    transcriptionErrorCode: v.optional(v.string()),
  }).index("by_business", ["businessId"])
    .index("by_customer", ["customerId"])
    .index("by_whatsapp_id", ["whatsappMessageId"])
    .index("by_business_event", ["businessId", "providerEventKey"])
    .index("by_conversation", ["conversationId", "timestamp"])
    .index("by_expiry", ["expiresAt"]),

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
    opportunityId: v.optional(v.id("missedRevenueOpportunities")),
    conversationId: v.optional(v.id("conversations")),
    triggerInteractionId: v.optional(v.id("interactions")),
    triggerAt: v.optional(v.number()),
    conversationRevision: v.optional(v.number()),
    journeyStage: v.optional(v.union(v.literal("viewer"), v.literal("engaged"), v.literal("intent"), v.literal("order_created"), v.literal("awaiting_payment"), v.literal("paid"), v.literal("lost"))),
    draftText: v.optional(v.string()),
    draftSource: v.optional(v.union(v.literal("template"), v.literal("ai"))),
    draftVersion: v.optional(v.string()),
    draftHash: v.optional(v.string()),
    aiState: v.optional(v.union(v.literal("disabled"), v.literal("pending"), v.literal("applied"), v.literal("fallback"))),
    guardrailCode: v.optional(v.string()),
    availableAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancellationReason: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    policySnapshot: v.optional(v.object({
      timezone: v.string(),
      cooldownMinutes: v.number(),
      dailyCap: v.number(),
      workHoursEnabled: v.boolean(),
      workHoursStart: v.number(),
      workHoursEnd: v.number(),
      quietHoursEnabled: v.boolean(),
      quietHoursStart: v.number(),
      quietHoursEnd: v.number(),
    })),
    actionKey: v.optional(v.string()),
    orderId: v.optional(v.id("orders")),
    manuallySentAt: v.optional(v.number()),
    sellerApprovedDraftHash: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal("won"), v.literal("lost"))),
    outcomeAt: v.optional(v.number()),
    estimatedValue: v.optional(v.number()),
    priorityScore: v.optional(v.number()),
    reasonSnapshot: v.optional(v.string()),
  }).index("by_business_due", ["businessId", "dueAt"])
    .index("by_customer_reason", ["customerId", "reason"])
    .index("by_customer_status", ["customerId", "status", "createdAt"])
    .index("by_customer", ["customerId"])
    .index("by_status", ["status"])
    .index("by_opportunity", ["opportunityId"])
    .index("by_trigger_interaction", ["triggerInteractionId"])
    .index("by_customer_status_trigger", ["customerId", "status", "triggerAt"])
    .index("by_business_status_available", ["businessId", "status", "availableAt"])
    .index("by_business_available", ["businessId", "availableAt"])
    .index("by_business_action_key", ["businessId", "actionKey"])
    .index("by_expiry", ["expiresAt"]),

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

  sellerActionEvents: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    taskId: v.optional(v.id("followUpTasks")),
    orderId: v.optional(v.id("orders")),
    type: v.union(v.literal("manual_send_claim"), v.literal("task_skipped"), v.literal("order_created"), v.literal("order_status_changed"), v.literal("outcome_won"), v.literal("outcome_lost")),
    idempotencyKey: v.string(),
    value: v.optional(v.number()),
    at: v.number(),
  }).index("by_business_time", ["businessId", "at"])
    .index("by_idempotency", ["businessId", "idempotencyKey"])
    .index("by_customer_time", ["customerId", "at"])
    .index("by_task_time", ["taskId", "at"]),

  revenueAttributions: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    taskId: v.id("followUpTasks"),
    orderId: v.id("orders"),
    opportunityId: v.id("missedRevenueOpportunities"),
    manualSentAt: v.number(),
    orderWonAt: v.number(),
    windowDays: v.number(),
    claimedValue: v.number(),
    confirmedValue: v.number(),
    evidenceLevel: v.literal("seller_recorded"),
    state: v.union(v.literal("claimed"), v.literal("rejected"), v.literal("reversed")),
    reason: v.string(),
    createdAt: v.number(),
  }).index("by_business_time", ["businessId", "createdAt"])
    .index("by_order", ["orderId"])
    .index("by_task", ["taskId"])
    .index("by_customer", ["customerId"]),


  aiActivityLog: defineTable({
    businessId: v.id("businesses"),
    type: v.union(
      v.literal("classification"),    // AI classified a message
      v.literal("image_analysis"),     // AI analyzed an image
      v.literal("smart_reply"),        // AI generated a follow-up reply
      v.literal("intent_upgrade"),     // AI upgraded keyword classification
      v.literal("error")              // AI processing failed (logged for debugging)
    ),
    interactionId: v.optional(v.id("interactions")),
    customerId: v.optional(v.id("customers")),
    customerName: v.optional(v.string()),
    summary: v.string(), // Human-readable summary of what AI did
    details: v.optional(v.string()), // JSON details (model used, tokens, etc.)
    model: v.string(), // Which model was used
    confidence: v.optional(v.number()),
    timestamp: v.number(),
  }).index("by_business_time", ["businessId", "timestamp"]),

  // ── Groups & Communities the owner has opted the AI into ──
  // By default the assistant stays silent in ALL group chats. A group only
  // becomes "AI-managed" when the owner flips it on from the settings screen.
  managedGroups: defineTable({
    businessId: v.id("businesses"),
    groupJid: v.string(),               // e.g. 12036...@g.us
    groupName: v.optional(v.string()),
    memberCount: v.optional(v.number()),
    // Owner's role in the group as reported by WhatsApp. We only surface
    // groups where the connected number is owner/admin by default.
    role: v.optional(v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("member"),
    )),
    // Owner-controlled toggle. false = assistant stays silent in this group.
    isEnabled: v.boolean(),
    // If true, assistant only replies when it's tagged/mentioned (safer default
    // for community groups). If false, assistant replies to any buying signal.
    mentionOnly: v.optional(v.boolean()),
    governanceMode: v.optional(v.union(
      v.literal("watch"),
      v.literal("suggest"),
      v.literal("mentions"),
      v.literal("common_questions"),
      v.literal("custom"),
    )),
    allowPrivateHandoff: v.optional(v.boolean()),
    customInstructions: v.optional(v.string()),
    // Metadata refresh
    lastRefreshedAt: v.optional(v.number()),
    enabledAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    addedAt: v.number(),
  }).index("by_business_group", ["businessId", "groupJid"])
    .index("by_business_enabled", ["businessId", "isEnabled"]),

  // Durable at-most-once assistant dispatch ledger. A dispatch that reaches
  // `submitting` is never automatically retried: provider timeouts are kept as
  // `unknown` so uncertainty cannot create duplicate WhatsApp replies.
  assistantDispatches: defineTable({
    businessId: v.id("businesses"),
    interactionId: v.id("interactions"),
    customerId: v.id("customers"),
    sessionId: v.id("whatsappSessions"),
    target: v.string(),
    isGroup: v.boolean(),
    content: v.string(),
    kind: v.optional(v.union(v.literal("assistant_reply"), v.literal("owner_rescue"))),
    ownerRescueId: v.optional(v.id("ownerRescueRequests")),
    qualificationQuestionField: v.optional(v.union(
      v.literal("need"),
      v.literal("budget"),
      v.literal("location"),
      v.literal("timeline"),
      v.literal("readiness"),
    )),
    state: v.union(
      v.literal("reserved"),
      v.literal("submitting"),
      v.literal("accepted"),
      v.literal("failed"),
      v.literal("unknown"),
      v.literal("cancelled"),
    ),
    attempts: v.number(),
    providerMessageId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_interaction", ["interactionId"])
    .index("by_owner_rescue", ["ownerRescueId", "createdAt"])
    .index("by_business_time", ["businessId", "createdAt"])
    .index("by_business_target_time", ["businessId", "target", "createdAt"]),

  dailySnapshots: defineTable({
    businessId: v.id("businesses"),
    date: v.string(), // "YYYY-MM-DD"
    statusesPosted: v.number(),
    totalViews: v.number(),
    uniqueViewers: v.number(),
    dmsStarted: v.number(),
    ordersCreated: v.number(),
    paymentsClosed: v.number(),
    revenueCollected: v.number(),
    followUpsSent: v.number(),
    revenueRecovered: v.number(),
    hotLeads: v.number(),
    coldViewers: v.number(),
    lostOpportunities: v.number(),
  }).index("by_business_date", ["businessId", "date"]),

  disconnectionAlerts: defineTable({

    businessId: v.id("businesses"),
    detectedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("resolved"), v.literal("dismissed")),
    notifiedAt: v.optional(v.number()), // When the in-app notification was shown
    durationMinutes: v.optional(v.number()), // How long disconnected before detected
  }).index("by_business_status", ["businessId", "status"])
    .index("by_business_detected", ["businessId", "detectedAt"]),

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

  whatsappSessions: defineTable(sessionFields)
    .index("by_business", ["businessId"])
    .index("by_provider", ["providerInstanceId"])
    .index("by_health_due", ["nextHealthAt"])
    .index("by_disconnect_due", ["state", "disconnectDueAt"]),
  inboundEvents: defineTable(eventFields)
    .index("by_session_key", ["sessionId", "eventKey"])
    .index("by_business_identity", ["businessId", "identityKey"])
    .index("by_business_state", ["businessId", "state", "receivedAt"])
    .index("by_due", ["state", "dueAt"])
    .index("by_expiry", ["expiresAt"]),
  conversations: defineTable({
    businessId: v.id("businesses"), customerId: v.id("customers"), identityKey: v.string(),
    revision: v.number(), lastEventAt: v.number(), lastInboundAt: v.optional(v.number()),
    lastOwnerAt: v.optional(v.number()), messageCount: v.number(),
    // Durable model history lives in the Agent component. This optional link is
    // additive so existing production conversations remain valid.
    agentThreadId: v.optional(v.string()),
  }).index("by_business_identity", ["businessId", "identityKey"])
    .index("by_business_activity", ["businessId", "lastEventAt"])
    .index("by_customer", ["customerId"]),
  communityOpportunities: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    conversationId: v.id("conversations"),
    interactionId: v.id("interactions"),
    sourceType: v.union(v.literal("group"), v.literal("direct")),
    sourceGroupJid: v.optional(v.string()),
    sourceGroupName: v.optional(v.string()),
    participantJid: v.optional(v.string()),
    participantName: v.optional(v.string()),
    category: v.union(v.literal("opportunity"), v.literal("question"), v.literal("complaint"), v.literal("commitment")),
    state: v.union(v.literal("open"), v.literal("in_progress"), v.literal("won"), v.literal("lost"), v.literal("dismissed")),
    urgency: v.union(v.literal("low"), v.literal("normal"), v.literal("high")),
    confidence: v.number(),
    evidenceText: v.string(),
    reason: v.string(),
    suggestedNextStep: v.string(),
    demandTopic: v.optional(v.string()),
    privateHandoffState: v.optional(v.union(v.literal("not_needed"), v.literal("suggested"), v.literal("consented"), v.literal("declined"), v.literal("completed"))),
    privateHandoffConsentAt: v.optional(v.number()),
    privateHandoffConsentInteractionId: v.optional(v.id("interactions")),
    assignedTo: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    outcomeValue: v.optional(v.number()),
    orderId: v.optional(v.id("orders")),
    createdAt: v.number(),
    updatedAt: v.number(),
    closedAt: v.optional(v.number()),
  }).index("by_interaction", ["interactionId"])
    .index("by_business_state_updated", ["businessId", "state", "updatedAt"])
    .index("by_business_source_created", ["businessId", "sourceType", "createdAt"])
    .index("by_business_group_created", ["businessId", "sourceGroupJid", "createdAt"])
    .index("by_customer_state", ["customerId", "state", "updatedAt"])
    .index("by_order", ["orderId"]),
  handoffEvents: defineTable({
    businessId: v.id("businesses"),
    opportunityId: v.id("communityOpportunities"),
    interactionId: v.id("interactions"),
    state: v.union(v.literal("consented"), v.literal("declined"), v.literal("completed")),
    evidenceText: v.string(),
    recordedAt: v.number(),
  }).index("by_opportunity_time", ["opportunityId", "recordedAt"])
    .index("by_business_time", ["businessId", "recordedAt"]),
  knowledgeSuggestions: defineTable({
    businessId: v.id("businesses"),
    interactionId: v.id("interactions"),
    opportunityId: v.optional(v.id("communityOpportunities")),
    question: v.string(),
    suggestedFact: v.string(),
    evidenceText: v.string(),
    state: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    createdAt: v.number(),
    reviewedAt: v.optional(v.number()),
  }).index("by_business_state_created", ["businessId", "state", "createdAt"])
    .index("by_interaction", ["interactionId"]),
  privacySuppressions: defineTable({
    businessId: v.id("businesses"), identityKey: v.string(), createdAt: v.number(),
  }).index("by_business_identity", ["businessId", "identityKey"]),
  deletionJobs: defineTable({
    businessId: v.id("businesses"), customerId: v.id("customers"), requestedAt: v.number(),
    state: v.union(v.literal("pending"), v.literal("done"), v.literal("dead_letter")), completedAt: v.optional(v.number()),
    attempts: v.number(), dueAt: v.number(), scheduledId: v.optional(v.id("_scheduled_functions")), errorCode: v.optional(v.string()),
  }).index("by_customer", ["customerId"]).index("by_state", ["state", "dueAt"]).index("by_business", ["businessId"]),
  deliveryReceipts: defineTable({
    businessId: v.id("businesses"), sessionId: v.id("whatsappSessions"), messageId: v.string(),
    identityKey: v.string(),
    deliveredAt: v.optional(v.number()), readAt: v.optional(v.number()), expiresAt: v.number(),
  }).index("by_session_message", ["sessionId", "messageId"]).index("by_expiry", ["expiresAt"]).index("by_business_identity", ["businessId", "identityKey"]),
  statusObservations: defineTable({
    businessId: v.id("businesses"), sessionId: v.id("whatsappSessions"), statusMessageId: v.string(),
    viewerIdentityKey: v.string(), observedAt: v.number(), expiresAt: v.number(),
  }).index("by_session_status_viewer", ["sessionId", "statusMessageId", "viewerIdentityKey"])
    .index("by_business_identity", ["businessId", "viewerIdentityKey"])
    .index("by_business_time", ["businessId", "observedAt"])
    .index("by_expiry", ["expiresAt"]),
  foundationAudit: defineTable({
    businessId: v.id("businesses"), kind: v.string(), correlationId: v.string(), at: v.number(),
    code: v.optional(v.string()), expiresAt: v.number(),
  }).index("by_business_time", ["businessId", "at"]).index("by_expiry", ["expiresAt"]),
  authAttempts: defineTable({
    key: v.string(), windowStart: v.number(), count: v.number(),
  }).index("by_key", ["key"]).index("by_window", ["windowStart"]),
  businessAiUsage: defineTable({
    businessId: v.id("businesses"),
    kind: v.union(v.literal("prompt_generation"), v.literal("voice_transcription")),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_business_kind", ["businessId", "kind"]),
  businessSubscriptions: defineTable({
    businessId: v.id("businesses"),
    provider: v.literal("paystack"),
    plan: v.union(v.literal("starter"), v.literal("growth"), v.literal("scale")),
    billingInterval: v.union(v.literal("monthly"), v.literal("annual")),
    status: v.union(
      v.literal("trialing"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("cancel_at_period_end"),
      v.literal("cancelled"),
      v.literal("expired"),
      v.literal("incomplete"),
    ),
    providerPlanCode: v.optional(v.string()),
    providerCustomerCode: v.optional(v.string()),
    providerSubscriptionCode: v.optional(v.string()),
    providerEmailTokenCiphertext: v.optional(v.string()),
    currency: v.literal("NGN"),
    amountKobo: v.number(),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    trialStartedAt: v.optional(v.number()),
    trialEndsAt: v.optional(v.number()),
    graceEndsAt: v.optional(v.number()),
    cancelAtPeriodEnd: v.boolean(),
    cancelledAt: v.optional(v.number()),
    lastPaymentAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_business", ["businessId"])
    .index("by_provider_subscription", ["provider", "providerSubscriptionCode"])
    .index("by_provider_customer", ["provider", "providerCustomerCode"])
    .index("by_status_period_end", ["status", "currentPeriodEnd"]),
  billingCheckoutIntents: defineTable({
    businessId: v.id("businesses"),
    ownerId: v.string(),
    reference: v.string(),
    plan: v.union(v.literal("starter"), v.literal("growth")),
    billingInterval: v.union(v.literal("monthly"), v.literal("annual")),
    providerPlanCode: v.string(),
    amountKobo: v.number(),
    currency: v.literal("NGN"),
    state: v.union(v.literal("initializing"), v.literal("pending"), v.literal("completed"), v.literal("failed"), v.literal("expired")),
    accessCode: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_reference", ["reference"])
    .index("by_business_created", ["businessId", "createdAt"])
    .index("by_state_expiry", ["state", "expiresAt"]),
  billingWebhookEvents: defineTable({
    provider: v.literal("paystack"),
    eventDigest: v.string(),
    eventType: v.string(),
    state: v.union(v.literal("processed"), v.literal("ignored"), v.literal("failed")),
    receivedAt: v.number(),
    processedAt: v.number(),
    businessId: v.optional(v.id("businesses")),
    reference: v.optional(v.string()),
    code: v.optional(v.string()),
  }).index("by_provider_digest", ["provider", "eventDigest"])
    .index("by_state_received", ["state", "receivedAt"]),
  billingPayments: defineTable({
    businessId: v.id("businesses"),
    provider: v.literal("paystack"),
    reference: v.string(),
    providerTransactionId: v.optional(v.string()),
    amountKobo: v.number(),
    currency: v.literal("NGN"),
    status: v.union(v.literal("success"), v.literal("failed"), v.literal("refunded")),
    channel: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_provider_reference", ["provider", "reference"])
    .index("by_business_created", ["businessId", "createdAt"])
    .index("by_status_created", ["status", "createdAt"]),
  billingUsagePeriods: defineTable({
    businessId: v.id("businesses"),
    periodStart: v.number(),
    periodEnd: v.number(),
    metric: v.literal("assisted_conversation"),
    quantity: v.number(),
    updatedAt: v.number(),
  }).index("by_business_metric_period", ["businessId", "metric", "periodStart"]),
  billingUsageConversations: defineTable({
    businessId: v.id("businesses"),
    conversationId: v.id("conversations"),
    periodStart: v.number(),
    firstAssistedAt: v.number(),
  }).index("by_business_period_conversation", ["businessId", "periodStart", "conversationId"])
    .index("by_business_period", ["businessId", "periodStart"]),
  foundationMigrations: defineTable({
    version: v.number(), state: v.union(v.literal("running"), v.literal("done")),
    cursor: v.optional(v.string()), processed: v.number(), updatedAt: v.number(),
  }).index("by_version", ["version"]),
  missedRevenueOpportunities: defineTable({
    businessId: v.id("businesses"), customerId: v.id("customers"), conversationId: v.id("conversations"), interactionId: v.id("interactions"),
    classifierVersion: v.string(), classifierConfidence: v.number(), ruleIds: v.array(v.string()),
    triggerAt: v.number(), responseWindowMinutes: v.number(), dueAt: v.number(), conversationRevision: v.optional(v.number()),
    state: v.union(v.literal("pending"), v.literal("missed"), v.literal("answered")),
    answeredAt: v.optional(v.number()), scheduledId: v.optional(v.id("_scheduled_functions")), expiresAt: v.number(),
  }).index("by_interaction", ["interactionId"])
    .index("by_business_state_due", ["businessId", "state", "dueAt"])
    .index("by_state_due", ["state", "dueAt"])
    .index("by_conversation_state", ["conversationId", "state", "triggerAt"])
    .index("by_customer", ["customerId"])
    .index("by_expiry", ["expiresAt"]),
  messageLabels: defineTable({
    businessId: v.id("businesses"), customerId: v.id("customers"), interactionId: v.id("interactions"),
    label: v.union(v.literal("buying_signal"), v.literal("inquiry"), v.literal("payment_related"), v.literal("casual_noise"), v.literal("manual_review")),
    labeledBy: v.string(), labeledAt: v.number(),
  }).index("by_interaction", ["interactionId"])
    .index("by_business_time", ["businessId", "labeledAt"])
    .index("by_customer", ["customerId"]),

  businessKnowledge: defineTable({
    businessId: v.id("businesses"),
    title: v.string(),
    kind: v.union(
      v.literal("business_fact"),
      v.literal("product"),
      v.literal("price"),
      v.literal("inventory"),
      v.literal("delivery"),
      v.literal("payment"),
      v.literal("returns"),
      v.literal("warranty"),
      v.literal("policy"),
      v.literal("faq"),
    ),
    content: v.string(),
    sourceType: v.union(v.literal("owner"), v.literal("system_prompt"), v.literal("catalog"), v.literal("integration"), v.literal("conversation")),
    sourceRef: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("needs_review"), v.literal("archived")),
    confidence: v.number(),
    effectiveAt: v.number(),
    expiresAt: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    verifiedBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_business_status_updated", ["businessId", "status", "updatedAt"])
    .index("by_business_kind_status", ["businessId", "kind", "status"])
    .index("by_business_source", ["businessId", "sourceType", "sourceRef"]),

  customerMemories: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    key: v.string(),
    value: v.string(),
    category: v.union(v.literal("preference"), v.literal("identity"), v.literal("purchase"), v.literal("delivery"), v.literal("support"), v.literal("relationship")),
    sourceInteractionId: v.optional(v.id("interactions")),
    state: v.union(v.literal("observed"), v.literal("verified"), v.literal("disputed"), v.literal("forgotten")),
    confidence: v.number(),
    lastObservedAt: v.number(),
    verifiedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_customer_state_updated", ["customerId", "state", "updatedAt"])
    .index("by_customer_key", ["customerId", "key"])
    .index("by_business_state_updated", ["businessId", "state", "updatedAt"]),

  conversationCommitments: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    conversationId: v.id("conversations"),
    sourceInteractionId: v.id("interactions"),
    actor: v.union(v.literal("customer"), v.literal("business")),
    kind: v.union(v.literal("follow_up"), v.literal("stock_check"), v.literal("price_check"), v.literal("payment"), v.literal("delivery"), v.literal("refund"), v.literal("replacement"), v.literal("appointment"), v.literal("other")),
    summary: v.string(),
    dueAt: v.optional(v.number()),
    state: v.union(v.literal("open"), v.literal("completed"), v.literal("cancelled"), v.literal("overdue")),
    confidence: v.number(),
    assignedTo: v.optional(v.string()),
    completionInteractionId: v.optional(v.id("interactions")),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_business_state_due", ["businessId", "state", "dueAt"])
    .index("by_state_due", ["state", "dueAt"])
    .index("by_customer_state_updated", ["customerId", "state", "updatedAt"])
    .index("by_source_interaction", ["sourceInteractionId"])
    .index("by_conversation_state", ["conversationId", "state", "createdAt"]),

  paymentProofs: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    conversationId: v.id("conversations"),
    interactionId: v.id("interactions"),
    orderId: v.optional(v.id("orders")),
    mediaId: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
    extractedAmount: v.optional(v.number()),
    extractedReference: v.optional(v.string()),
    extractedBeneficiary: v.optional(v.string()),
    extractedPaidAt: v.optional(v.number()),
    duplicateFingerprint: v.optional(v.string()),
    receiptState: v.union(v.literal("received"), v.literal("unreadable"), v.literal("review_required"), v.literal("rejected"), v.literal("matched")),
    verificationState: v.union(v.literal("not_started"), v.literal("pending"), v.literal("verified"), v.literal("not_found"), v.literal("mismatch"), v.literal("unavailable")),
    verificationProvider: v.optional(v.string()),
    verificationReason: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_interaction", ["interactionId"])
    .index("by_business_verification_updated", ["businessId", "verificationState", "updatedAt"])
    .index("by_customer_created", ["customerId", "createdAt"])
    .index("by_business_fingerprint", ["businessId", "duplicateFingerprint"]),

  commerceExceptions: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    conversationId: v.id("conversations"),
    interactionId: v.id("interactions"),
    orderId: v.optional(v.id("orders")),
    kind: v.union(v.literal("complaint"), v.literal("delay"), v.literal("out_of_stock"), v.literal("payment_failure"), v.literal("wrong_item"), v.literal("damaged_item"), v.literal("refund"), v.literal("return"), v.literal("warranty"), v.literal("delivery_fee"), v.literal("incorrect_information"), v.literal("other")),
    severity: v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("critical")),
    state: v.union(v.literal("open"), v.literal("waiting_on_business"), v.literal("waiting_on_customer"), v.literal("resolved"), v.literal("dismissed")),
    summary: v.string(),
    proposedResolution: v.optional(v.string()),
    approvedResolution: v.optional(v.string()),
    ownerQuestion: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    resolutionInteractionId: v.optional(v.id("interactions")),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_business_state_severity", ["businessId", "state", "severity"])
    .index("by_customer_state_updated", ["customerId", "state", "updatedAt"])
    .index("by_interaction", ["interactionId"]),

  ownerRescueRequests: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    conversationId: v.id("conversations"),
    interactionId: v.id("interactions"),
    exceptionId: v.optional(v.id("commerceExceptions")),
    reason: v.union(v.literal("missing_fact"), v.literal("conflicting_fact"), v.literal("policy_approval"), v.literal("discount_approval"), v.literal("payment_review"), v.literal("complaint"), v.literal("high_risk"), v.literal("other")),
    question: v.string(),
    customerHoldingReply: v.string(),
    contextSummary: v.string(),
    state: v.union(v.literal("open"), v.literal("sending"), v.literal("answered"), v.literal("delivery_unknown"), v.literal("expired"), v.literal("cancelled")),
    ownerAnswer: v.optional(v.string()),
    deliveryError: v.optional(v.string()),
    answeredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  }).index("by_business_state_created", ["businessId", "state", "createdAt"])
    .index("by_interaction", ["interactionId"])
    .index("by_customer_state", ["customerId", "state", "createdAt"]),

  negotiationPolicies: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    scope: v.union(v.literal("all"), v.literal("category"), v.literal("product")),
    scopeRef: v.optional(v.string()),
    minimumPrice: v.optional(v.number()),
    maximumDiscountPercent: v.number(),
    freeDeliveryThreshold: v.optional(v.number()),
    allowedBundles: v.array(v.string()),
    requireApprovalBelow: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_business_active_scope", ["businessId", "isActive", "scope"]),

  leadQualifications: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    conversationId: v.id("conversations"),
    status: v.union(v.literal("qualifying"), v.literal("qualified"), v.literal("not_qualified"), v.literal("opted_out"), v.literal("stalled")),
    answers: v.array(v.object({
      field: v.union(v.literal("need"), v.literal("budget"), v.literal("location"), v.literal("timeline"), v.literal("readiness")),
      value: v.string(),
      confidence: v.number(),
      sourceInteractionId: v.id("interactions"),
      updatedAt: v.number(),
    })),
    missingFields: v.array(v.union(v.literal("need"), v.literal("budget"), v.literal("location"), v.literal("timeline"), v.literal("readiness"))),
    questionAttempts: v.array(v.object({
      field: v.union(v.literal("need"), v.literal("budget"), v.literal("location"), v.literal("timeline"), v.literal("readiness")),
      count: v.number(),
      lastAskedAt: v.number(),
    })),
    score: v.number(),
    fitState: v.union(v.literal("fit"), v.literal("uncertain"), v.literal("not_fit")),
    fitConfidence: v.number(),
    fitReason: v.optional(v.string()),
    lastAssessedInteractionId: v.id("interactions"),
    lastQuestionField: v.optional(v.union(v.literal("need"), v.literal("budget"), v.literal("location"), v.literal("timeline"), v.literal("readiness"))),
    lastQuestionAt: v.optional(v.number()),
    qualifiedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_conversation", ["conversationId"])
    .index("by_customer_updated", ["customerId", "updatedAt"])
    .index("by_business_status_updated", ["businessId", "status", "updatedAt"]),

  conversationOutcomes: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    conversationId: v.id("conversations"),
    outcome: v.union(v.literal("paid"), v.literal("booked"), v.literal("qualified"), v.literal("abandoned"), v.literal("lost_price"), v.literal("lost_stock"), v.literal("lost_delivery"), v.literal("resolved_support"), v.literal("unresolved_support")),
    value: v.optional(v.number()),
    objection: v.optional(v.string()),
    decisiveInteractionId: v.optional(v.id("interactions")),
    sourceCampaignId: v.optional(v.string()),
    sourceAdSetId: v.optional(v.string()),
    sourceAdId: v.optional(v.string()),
    sourceCreativeId: v.optional(v.string()),
    recordedBy: v.union(v.literal("system"), v.literal("owner"), v.literal("integration")),
    occurredAt: v.number(),
    createdAt: v.number(),
  }).index("by_business_occurred", ["businessId", "occurredAt"])
    .index("by_occurred", ["occurredAt"])
    .index("by_business_outcome_occurred", ["businessId", "outcome", "occurredAt"])
    .index("by_conversation_occurred", ["conversationId", "occurredAt"])
    .index("by_ad_occurred", ["businessId", "sourceAdId", "occurredAt"]),
});
