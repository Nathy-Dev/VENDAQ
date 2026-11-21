import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import { requireIdentity } from "./lib/authorization";
import { businessSystemPromptMessages, cleanBusinessText, promptSourceMaximum, promptSourceMinimum } from "./lib/businessPrompt";
import { audioExtension, resolveTranscriptionModel, transcribeWithOpenAI, transcriptionErrorCode } from "./lib/openaiTranscription";
import { BUSINESS_SYSTEM_PROMPT_MAX_LENGTH } from "./lib/launch";

const maximumRecordingBytes = 10 * 1024 * 1024;

function applicationOrigin(): string | null {
  try {
    return process.env.AUTH_JWT_ISSUER ? new URL(process.env.AUTH_JWT_ISSUER).origin : null;
  } catch {
    return null;
  }
}

function noStoreHeaders(request?: Request, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store, no-transform");
  headers.set("X-Content-Type-Options", "nosniff");
  const origin = request?.headers.get("Origin");
  if (origin && origin === applicationOrigin()) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
  }
  return headers;
}

async function authorize(ctx: Parameters<Parameters<typeof httpAction>[0]>[0], businessId: Id<"businesses">) {
  const identity = await requireIdentity(ctx);
  return await ctx.runQuery(internal.businessProfile.authorizeForGeneration, { businessId, ownerId: identity.subject });
}

function errorResponse(request: Request, error: unknown, fallback: string): Response {
  if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null && "code" in error.data) {
    const code = String((error.data as { code: unknown }).code);
    if (code === "UNAUTHENTICATED") return Response.json({ error: code }, { status: 401, headers: noStoreHeaders(request) });
    if (code === "NOT_FOUND") return Response.json({ error: code }, { status: 404, headers: noStoreHeaders(request) });
  }
  return Response.json({ error: fallback }, { status: 502, headers: noStoreHeaders(request) });
}

function transcriptionErrorResponse(request: Request, code: string): Response {
  if (code === "OPENAI_TRANSCRIPTION_RATE_LIMITED") {
    return Response.json({ error: code }, { status: 429, headers: noStoreHeaders(request, { "Retry-After": "60" }) });
  }
  if (code === "OPENAI_TRANSCRIPTION_QUOTA_EXHAUSTED") {
    return Response.json({ error: code }, { status: 429, headers: noStoreHeaders(request, { "Retry-After": "300" }) });
  }
  if (code === "OPENAI_TRANSCRIPTION_TIMEOUT") {
    return Response.json({ error: code }, { status: 504, headers: noStoreHeaders(request) });
  }
  if (code === "AUDIO_SIZE_NOT_SUPPORTED") {
    return Response.json({ error: code }, { status: 422, headers: noStoreHeaders(request) });
  }
  if (["OPENAI_TRANSCRIPTION_AUTH_FAILED", "OPENAI_TRANSCRIPTION_NOT_CONFIGURED"].includes(code)) {
    return Response.json({ error: code }, { status: 503, headers: noStoreHeaders(request) });
  }
  return Response.json({ error: code }, { status: 502, headers: noStoreHeaders(request) });
}

function completionTextStream(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let emitted = 0;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      try {
        while (true) {
          const boundary = buffer.search(/\r?\n\r?\n/);
          if (boundary >= 0) {
            const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + separator.length);
            for (const line of block.split(/\r?\n/)) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data) continue;
              if (data === "[DONE]") {
                closed = true;
                await reader.cancel();
                controller.close();
                return;
              }
              const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
              const raw = payload.choices?.[0]?.delta?.content;
              if (typeof raw !== "string" || !raw) continue;
              const remaining = BUSINESS_SYSTEM_PROMPT_MAX_LENGTH - emitted;
              const text = raw.replaceAll("\u0000", "").slice(0, Math.max(0, remaining));
              if (text) {
                emitted += text.length;
                controller.enqueue(encoder.encode(text));
                return;
              }
              if (remaining <= 0) {
                closed = true;
                await reader.cancel();
                controller.close();
                return;
              }
            }
            continue;
          }
          const next = await reader.read();
          if (next.done) {
            closed = true;
            controller.close();
            return;
          }
          buffer += decoder.decode(next.value, { stream: true });
        }
      } catch (error) {
        closed = true;
        await reader.cancel().catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel() {
      closed = true;
      await reader.cancel().catch(() => undefined);
    },
  });
}

export const transcribeBusinessDescription = httpAction(async (ctx, request) => {
  try {
    const form = await request.formData();
    const businessId = form.get("businessId");
    const recording = form.get("recording");
    if (typeof businessId !== "string" || !(recording instanceof Blob)) {
      return Response.json({ error: "INVALID_RECORDING" }, { status: 400, headers: noStoreHeaders(request) });
    }
    if (!(await authorize(ctx, businessId as Id<"businesses">))) {
      return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: noStoreHeaders(request) });
    }
    if (recording.size < 512 || recording.size > maximumRecordingBytes || !recording.type.toLowerCase().startsWith("audio/")) {
      return Response.json({ error: "INVALID_RECORDING" }, { status: 400, headers: noStoreHeaders(request) });
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "TRANSCRIPTION_NOT_CONFIGURED" }, { status: 503, headers: noStoreHeaders(request) });
    if (!(await ctx.runMutation(internal.businessProfile.consumeBusinessAiUsage, { businessId: businessId as Id<"businesses">, kind: "voice_transcription" }))) {
      return Response.json({ error: "BUSINESS_AI_RATE_LIMITED" }, { status: 429, headers: noStoreHeaders(request, { "Retry-After": "3600" }) });
    }
    const result = await transcribeWithOpenAI({
      audio: recording,
      apiKey,
      model: resolveTranscriptionModel(process.env.OPENAI_TRANSCRIPTION_MODEL),
      fileName: `business-description.${audioExtension(recording.type)}`,
    });
    const transcript = cleanBusinessText(result.text).slice(0, promptSourceMaximum);
    if (transcript.length < 2) return Response.json({ error: "EMPTY_TRANSCRIPT" }, { status: 422, headers: noStoreHeaders(request) });
    return Response.json({ transcript, language: result.language ?? null }, { headers: noStoreHeaders(request) });
  } catch (error) {
    if (error instanceof ConvexError) return errorResponse(request, error, "TRANSCRIPTION_FAILED");
    const code = transcriptionErrorCode(error);
    console.warn("Business-description transcription failed", { code });
    return transcriptionErrorResponse(request, code);
  }
});

export const streamBusinessSystemPrompt = httpAction(async (ctx, request) => {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return Response.json({ error: "INVALID_CONTENT_TYPE" }, { status: 415, headers: noStoreHeaders(request) });
    }
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > 16_384) return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413, headers: noStoreHeaders(request) });
    const body = await request.json() as { businessId?: unknown; businessDescription?: unknown };
    if (typeof body.businessId !== "string" || typeof body.businessDescription !== "string") {
      return Response.json({ error: "INVALID_BUSINESS_DESCRIPTION" }, { status: 400, headers: noStoreHeaders(request) });
    }
    const business = await authorize(ctx, body.businessId as Id<"businesses">);
    if (!business) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: noStoreHeaders(request) });
    const description = cleanBusinessText(body.businessDescription);
    if (description.length < promptSourceMinimum || description.length > promptSourceMaximum) {
      return Response.json({ error: "INVALID_BUSINESS_DESCRIPTION" }, { status: 400, headers: noStoreHeaders(request) });
    }
    const apiKey = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_LLM_MODEL?.trim();
    if (!apiKey || !model) return Response.json({ error: "AI_PROVIDER_NOT_CONFIGURED" }, { status: 503, headers: noStoreHeaders(request) });
    if (!(await ctx.runMutation(internal.businessProfile.consumeBusinessAiUsage, { businessId: body.businessId as Id<"businesses">, kind: "prompt_generation" }))) {
      return Response.json({ error: "BUSINESS_AI_RATE_LIMITED" }, { status: 429, headers: noStoreHeaders(request, { "Retry-After": "3600" }) });
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1_600,
        stream: true,
        messages: businessSystemPromptMessages(business.name, description),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !response.body) {
      return Response.json({ error: "AI_GENERATION_FAILED" }, { status: 502, headers: noStoreHeaders(request) });
    }
    return new Response(completionTextStream(response.body), {
      headers: noStoreHeaders(request, {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Accel-Buffering": "no",
      }),
    });
  } catch (error) {
    return errorResponse(request, error, "AI_GENERATION_FAILED");
  }
});

export const businessAiOptions = httpAction(async (_, request) => {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== applicationOrigin()) return new Response(null, { status: 403, headers: noStoreHeaders(request) });
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(request, {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
    }),
  });
});
