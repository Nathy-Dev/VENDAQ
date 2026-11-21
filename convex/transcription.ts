import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { decryptSecret } from "./lib/crypto";
import { keywordClassifier } from "./lib/classifier";
import { downloadAuthorizedInboundAudio } from "./lib/evolution";
import { audioExtension, resolveTranscriptionModel, transcribeWithOpenAI, transcriptionErrorCode } from "./lib/openaiTranscription";

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
    if (!(interaction.isGroup ?? false)) await ctx.scheduler.runAfter(0, internal.commerceIntelligence.captureFromInteraction, { interactionId: interaction._id });
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

export const defer = internalMutation({
  args: { interactionId: v.id("interactions"), code: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.interactionId);
    if (!interaction || interaction.transcriptionState !== "pending") return false;
    await ctx.db.patch(interaction._id, { transcriptionErrorCode: args.code.slice(0, 120) });
    return true;
  },
});

export const transcribe = internalAction({
  args: { interactionId: v.id("interactions"), mediaPayload: v.string(), mediaMimeType: v.optional(v.string()), retryAttempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const retryAttempt = Math.max(0, Math.floor(args.retryAttempt ?? 0));
    if (retryAttempt === 0 && !(await ctx.runMutation(internal.transcription.markPending, { interactionId: args.interactionId }))) return null;
    try {
      const current = await ctx.runQuery(internal.transcription.prepare, {
        interactionId: args.interactionId,
        mediaPayload: args.mediaPayload,
        ...(args.mediaMimeType ? { mediaMimeType: args.mediaMimeType } : {}),
      });
      if (!current) throw new Error("TRANSCRIPTION_NOT_ELIGIBLE");
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_TRANSCRIPTION_NOT_CONFIGURED");
      const model = resolveTranscriptionModel(process.env.OPENAI_TRANSCRIPTION_MODEL);
      const token = await decryptSecret(current.tokenCiphertext, `business:${current.businessId}:session-token`);
      const message = JSON.parse(current.mediaPayload) as Record<string, unknown>;
      const audio = await downloadAuthorizedInboundAudio({ token, instanceId: current.providerInstanceId, message });
      const mimeType = (audio.mimetype || current.mediaMimeType).split(";")[0].trim().toLowerCase() || "audio/ogg";
      const result = await transcribeWithOpenAI({
        audio: new Blob([audio.bytes.slice().buffer], { type: mimeType }),
        apiKey,
        model,
        fileName: `voice-note.${audioExtension(mimeType)}`,
      });
      await ctx.runMutation(internal.transcription.finish, {
        interactionId: current.interactionId,
        transcript: result.text,
        ...(result.language ? { language: result.language } : {}),
      });
    } catch (error) {
      const code = transcriptionErrorCode(error);
      if (code === "OPENAI_TRANSCRIPTION_RATE_LIMITED" && retryAttempt < 2) {
        if (await ctx.runMutation(internal.transcription.defer, { interactionId: args.interactionId, code })) {
          const delayMs = retryAttempt === 0 ? 60_000 : 180_000;
          console.warn("Voice-note transcription deferred", { interactionId: args.interactionId, code, retryAttempt: retryAttempt + 1, delayMs });
          await ctx.scheduler.runAfter(delayMs, internal.transcription.transcribe, { ...args, retryAttempt: retryAttempt + 1 });
        }
        return null;
      }
      console.warn("Voice-note transcription failed", { interactionId: args.interactionId, code });
      await ctx.runMutation(internal.transcription.fail, { interactionId: args.interactionId, code });
    }
    return null;
  },
});
