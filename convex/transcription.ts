import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { decryptSecret } from "./lib/crypto";
import { keywordClassifier } from "./lib/classifier";
import { downloadAuthorizedInboundAudio } from "./lib/evolution";

const NIGERIAN_SPEECH_PROMPT = "Na Nigerian WhatsApp voice note be this. Write wetin the person talk exactly as dem talk am. Keep Nigerian Pidgin, Nigerian English, names, and any code-switching as spoken. No translate and no correct the grammar. Common words fit include abeg, dey, no wahala, una, wetin, na, e, sabi, sha, abi, and oga.";

function audioExtension(mimeType: string): string {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  if (normalized === "audio/flac") return "flac";
  if (["audio/mpeg", "audio/mp3"].includes(normalized)) return "mp3";
  if (["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(normalized)) return "m4a";
  if (["audio/wav", "audio/x-wav", "audio/wave"].includes(normalized)) return "wav";
  if (normalized === "audio/webm") return "webm";
  return "ogg";
}

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
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_TRANSCRIPTION_NOT_CONFIGURED");
      const model = process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1";
      const token = await decryptSecret(current.tokenCiphertext, `business:${current.businessId}:session-token`);
      const message = JSON.parse(current.mediaPayload) as Record<string, unknown>;
      const audio = await downloadAuthorizedInboundAudio({ token, instanceId: current.providerInstanceId, message });
      const mimeType = (audio.mimetype || current.mediaMimeType).split(";")[0].trim().toLowerCase() || "audio/ogg";
      const form = new FormData();
      form.append("file", new Blob([audio.bytes.slice().buffer], { type: mimeType }), `voice-note.${audioExtension(mimeType)}`);
      form.append("model", model);
      form.append("response_format", "verbose_json");
      form.append("temperature", "0");
      form.append("prompt", NIGERIAN_SPEECH_PROMPT);
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error("OPENAI_TRANSCRIPTION_AUTH_FAILED");
        if (response.status === 413) throw new Error("AUDIO_SIZE_NOT_SUPPORTED");
        if (response.status === 429) throw new Error("OPENAI_TRANSCRIPTION_RATE_LIMITED");
        throw new Error("OPENAI_TRANSCRIPTION_FAILED");
      }
      const result = await response.json() as { text?: string; language?: string };
      await ctx.runMutation(internal.transcription.finish, { interactionId: current.interactionId, transcript: result.text ?? "", ...(result.language ? { language: result.language } : {}) });
    } catch (error) {
      await ctx.runMutation(internal.transcription.fail, { interactionId: args.interactionId, code: error instanceof Error ? error.message : "TRANSCRIPTION_FAILED" });
    }
    return null;
  },
});
