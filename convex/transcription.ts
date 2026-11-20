import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { decryptSecret } from "./lib/crypto";
import { keywordClassifier } from "./lib/classifier";
import { downloadAuthorizedInboundAudio } from "./lib/evolution";

const candidate = v.object({
  interactionId: v.id("interactions"), businessId: v.id("businesses"), customerId: v.id("customers"),
  sessionId: v.id("whatsappSessions"), providerInstanceId: v.string(), tokenCiphertext: v.string(), mediaPayload: v.string(), mediaMimeType: v.string(),
});

export const prepare = internalQuery({
  args: { interactionId: v.id("interactions"), mediaPayload: v.string(), mediaMimeType: v.optional(v.string()) },
  returns: v.union(candidate, v.null()),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.role !== "customer" || interaction.messageType !== "audio" || !interaction.sessionId || interaction.transcriptionState === "completed" || interaction.transcriptionState !== "pending") return null;
    const [session, business, customer] = await Promise.all([ctx.db.get(interaction.sessionId), ctx.db.get(interaction.businessId), ctx.db.get(interaction.customerId)]);
    if (!session || session.state !== "connected" || !session.providerInstanceId || !business || business.foundationVersion !== 1 || !customer || customer.deletedAt !== undefined) return null;
    return { interactionId: interaction._id, businessId: business._id, customerId: customer._id, sessionId: session._id, providerInstanceId: session.providerInstanceId, tokenCiphertext: session.tokenCiphertext, mediaPayload: args.mediaPayload, mediaMimeType: args.mediaMimeType ?? "audio/ogg" };
  },
});

export const markPending = internalMutation({
  args: { interactionId: v.id("interactions") }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.transcriptionState === "completed" || interaction.transcriptionState === "pending") return false;
    await ctx.db.patch(interaction._id, { transcriptionState: "pending", transcriptionErrorCode: undefined });
    return true;
  },
});

export const finish = internalMutation({
  args: { interactionId: v.id("interactions"), transcript: v.string(), language: v.optional(v.string()), confidence: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.role !== "customer" || interaction.messageType !== "audio") return null;
    const transcript = args.transcript.replaceAll("\u0000", "").trim().slice(0, 8_000);
    if (transcript.length < 2) { await ctx.db.patch(interaction._id, { transcriptionState: "failed", transcriptionErrorCode: "EMPTY_TRANSCRIPT" }); return null; }
    const classification = keywordClassifier.classify({ text: transcript, mediaType: "text", manualReview: false });
    await ctx.db.patch(interaction._id, {
      content: transcript, transcript, transcriptLanguage: args.language, transcriptConfidence: args.confidence,
      transcriptionState: "completed", transcribedAt: Date.now(), transcriptionErrorCode: undefined,
      manualReviewRequired: false, classifierLabel: classification.label, classifierVersion: classification.version,
      classifierConfidence: classification.confidence, classifierRuleIds: classification.ruleIds, classifiedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.communityEngine.captureFromInteraction, { interactionId: interaction._id });
    await ctx.scheduler.runAfter(0, internal.assistantReply.prepareForInteraction, { interactionId: interaction._id });
    return null;
  },
});

export const fail = internalMutation({
  args: { interactionId: v.id("interactions"), code: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    if (interaction && interaction.transcriptionState === "pending") await ctx.db.patch(interaction._id, { transcriptionState: "failed", transcriptionErrorCode: args.code.slice(0, 120) });
    return null;
  },
});

export const transcribe = internalAction({
  args: { interactionId: v.id("interactions"), mediaPayload: v.string(), mediaMimeType: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await ctx.runMutation(internal.transcription.markPending, { interactionId: args.interactionId }))) return null;
    try {
      const current = await ctx.runQuery(internal.transcription.prepare, args);
      if (!current) throw new Error("TRANSCRIPTION_NOT_ELIGIBLE");
      const apiKey = process.env.DEEPGRAM_API_KEY;
      if (!apiKey) throw new Error("DEEPGRAM_NOT_CONFIGURED");
      const token = await decryptSecret(current.tokenCiphertext, `business:${current.businessId}:session-token`);
      const message = JSON.parse(current.mediaPayload) as Record<string, unknown>;
      const audio = await downloadAuthorizedInboundAudio({ token, instanceId: current.providerInstanceId, message });
      const response = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&detect_language=true&diarize=false", {
        method: "POST",
        headers: { Authorization: `Token ${apiKey}`, "Content-Type": audio.mimetype || current.mediaMimeType },
        body: new Blob([audio.bytes.slice().buffer], { type: audio.mimetype || current.mediaMimeType }),
        signal: AbortSignal.timeout(35_000),
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "DEEPGRAM_AUTH_FAILED" : "DEEPGRAM_TRANSCRIPTION_FAILED");
      const result = await response.json() as { results?: { channels?: Array<{ detected_language?: string; alternatives?: Array<{ transcript?: string; confidence?: number }> }> } };
      const channel = result.results?.channels?.[0];
      const alternative = channel?.alternatives?.[0];
      await ctx.runMutation(internal.transcription.finish, { interactionId: current.interactionId, transcript: alternative?.transcript ?? "", ...(channel?.detected_language ? { language: channel.detected_language } : {}), ...(typeof alternative?.confidence === "number" ? { confidence: alternative.confidence } : {}) });
    } catch (error) {
      await ctx.runMutation(internal.transcription.fail, { interactionId: args.interactionId, code: error instanceof Error ? error.message : "TRANSCRIPTION_FAILED" });
    }
    return null;
  },
});
