import { v, type Infer } from "convex/values";

export const mediaType = v.union(v.literal("text"), v.literal("image"), v.literal("video"), v.literal("audio"), v.literal("document"), v.literal("location"), v.literal("unsupported"));
export const connectionState = v.union(v.literal("provisioning"), v.literal("pending"), v.literal("connected"), v.literal("disconnected"), v.literal("error"), v.literal("revoked"));
export const receiptState = v.union(v.literal("delivered"), v.literal("read"), v.literal("read_self"));
export const normalizedEvent = v.union(
  v.object({ kind: v.literal("message"), messageId: v.string(), chat: v.string(), identityKey: v.string(), fromMe: v.boolean(), name: v.optional(v.string()), text: v.string(), mediaType, eventAt: v.number(), manualReview: v.boolean() }),
  v.object({ kind: v.literal("receipt"), chat: v.string(), sender: v.string(), identityKey: v.string(), messageIds: v.array(v.string()), state: receiptState, eventAt: v.number() }),
  v.object({ kind: v.literal("connection"), event: v.string(), eventAt: v.optional(v.number()), qrCiphertext: v.optional(v.string()) }),
  v.object({ kind: v.literal("ignored"), reason: v.string() }),
);
export type NormalizedEvent = Infer<typeof normalizedEvent>;

export const sessionFields = {
  businessId: v.id("businesses"),
  instanceName: v.string(),
  providerInstanceId: v.optional(v.string()),
  generation: v.number(),
  state: connectionState,
  tokenCiphertext: v.string(),
  tokenHash: v.string(),
  disclosureVersion: v.string(),
  consentAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastHealthAt: v.optional(v.number()),
  nextHealthAt: v.number(),
  operationLeaseUntil: v.optional(v.number()),
  operationVersion: v.optional(v.number()),
  createAttemptedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  qrCiphertext: v.optional(v.string()),
  qrExpiresAt: v.optional(v.number()),
  disconnectAttempts: v.optional(v.number()),
  disconnectDueAt: v.optional(v.number()),
  disconnectedAt: v.optional(v.number()),
};
export const sessionDocument = v.object({ _id: v.id("whatsappSessions"), _creationTime: v.number(), ...sessionFields });
export const eventState = v.union(v.literal("pending"), v.literal("processing"), v.literal("processed"), v.literal("ignored"), v.literal("dead_letter"));
export const eventFields = {
  businessId: v.id("businesses"),
  sessionId: v.id("whatsappSessions"),
  generation: v.number(),
  eventKey: v.string(),
  correlationId: v.string(),
  payload: v.optional(normalizedEvent),
  identityKey: v.optional(v.string()),
  state: eventState,
  attempts: v.number(),
  retryLimit: v.optional(v.number()),
  receivedAt: v.number(),
  dueAt: v.number(),
  expiresAt: v.number(),
  completedAt: v.optional(v.number()),
  errorCode: v.optional(v.string()),
  scheduledId: v.optional(v.id("_scheduled_functions")),
};
export const eventDocument = v.object({ _id: v.id("inboundEvents"), _creationTime: v.number(), ...eventFields });
