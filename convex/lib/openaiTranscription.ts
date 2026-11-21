export const NIGERIAN_SPEECH_PROMPT = "Na Nigerian WhatsApp voice note be this. Write wetin the person talk exactly as dem talk am. Keep Nigerian Pidgin, Nigerian English, names, and any code-switching as spoken. No translate and no correct the grammar. Common words fit include abeg, dey, no wahala, una, wetin, na, e, sabi, sha, abi, and oga.";

export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-transcribe";

export function resolveTranscriptionModel(configuredModel?: string): string {
  const model = configuredModel?.trim();
  return model || DEFAULT_TRANSCRIPTION_MODEL;
}

export function transcriptionLanguage(result: { language?: unknown; languages?: unknown }): string | undefined {
  if (Array.isArray(result.languages)) {
    const detected = result.languages.find((language): language is { code: string } =>
      typeof language === "object" && language !== null && typeof (language as { code?: unknown }).code === "string"
    );
    if (detected?.code.trim()) return detected.code.trim();
  }
  return typeof result.language === "string" && result.language.trim() ? result.language.trim() : undefined;
}

export function transcriptionHttpError(status: number, providerCode?: string): string {
  if (status === 401 || status === 403) return "OPENAI_TRANSCRIPTION_AUTH_FAILED";
  if (status === 413) return "AUDIO_SIZE_NOT_SUPPORTED";
  if (status === 429) {
    const normalizedCode = providerCode?.trim().toLowerCase();
    if (["billing_hard_limit_reached", "billing_not_active", "insufficient_quota", "quota_exceeded"].includes(normalizedCode ?? "")) {
      return "OPENAI_TRANSCRIPTION_QUOTA_EXHAUSTED";
    }
    return "OPENAI_TRANSCRIPTION_RATE_LIMITED";
  }
  return `OPENAI_TRANSCRIPTION_HTTP_${status}`;
}

export function transcriptionErrorCode(error: unknown): string {
  if (error instanceof Error && /^OPENAI_TRANSCRIPTION_[A-Z0-9_]+$/.test(error.message)) return error.message;
  if (error instanceof Error && new Set([
    "AUDIO_SIZE_NOT_SUPPORTED",
    "ENCRYPTION_NOT_CONFIGURED",
    "INVALID_AUDIO_DOWNLOAD",
    "INVALID_CIPHERTEXT",
    "INVALID_ENCRYPTION_CONFIGURATION",
    "INVALID_ENCRYPTION_KEY",
    "INVALID_PROVIDER_AUTH_MODE",
    "INVALID_PROVIDER_URL",
    "INSECURE_PROVIDER_URL",
    "OPENAI_TRANSCRIPTION_NOT_CONFIGURED",
    "PROVIDER_AUDIO_DOWNLOAD_FAILED",
    "PROVIDER_AUTH_FAILED",
    "PROVIDER_DISABLED",
    "PROVIDER_NOT_CONFIGURED",
    "PROVIDER_REQUEST_FAILED",
    "TRANSCRIPTION_NOT_ELIGIBLE",
  ]).has(error.message)) return error.message;
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return "OPENAI_TRANSCRIPTION_TIMEOUT";
  return "OPENAI_TRANSCRIPTION_FAILED";
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status >= 500;
}

async function providerErrorCode(response: Response): Promise<string | undefined> {
  try {
    const payload = await response.json() as { error?: { code?: unknown; type?: unknown } };
    if (typeof payload.error?.code === "string" && payload.error.code.trim()) return payload.error.code;
    if (typeof payload.error?.type === "string" && payload.error.type.trim()) return payload.error.type;
  } catch {
    // Provider bodies are not trusted and never need to be retained or logged.
  }
  return undefined;
}

export function audioExtension(mimeType: string): string {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  if (normalized === "audio/flac") return "flac";
  if (["audio/mpeg", "audio/mp3"].includes(normalized)) return "mp3";
  if (["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(normalized)) return "m4a";
  if (["audio/wav", "audio/x-wav", "audio/wave"].includes(normalized)) return "wav";
  if (normalized === "audio/webm") return "webm";
  return "ogg";
}

export async function transcribeWithOpenAI(args: {
  audio: Blob;
  apiKey: string;
  model: string;
  fileName?: string;
  timeoutMs?: number;
  maximumAttempts?: number;
}): Promise<{ text: string; language?: string }> {
  const mimeType = args.audio.type.split(";")[0].trim().toLowerCase() || "audio/ogg";
  const model = resolveTranscriptionModel(args.model);
  const maximumAttempts = Math.min(3, Math.max(1, args.maximumAttempts ?? 3));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const form = new FormData();
      form.append("file", args.audio, args.fileName ?? `voice-note.${audioExtension(mimeType)}`);
      form.append("model", model);
      form.append("prompt", NIGERIAN_SPEECH_PROMPT);
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${args.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(args.timeoutMs ?? 45_000),
      });
      if (!response.ok) {
        const error = new Error(transcriptionHttpError(response.status, await providerErrorCode(response)));
        if (!retryableStatus(response.status) || attempt === maximumAttempts) throw error;
        lastError = error;
      } else {
        let result: { text?: unknown; language?: unknown; languages?: unknown };
        try {
          result = await response.json() as typeof result;
        } catch {
          throw new Error("OPENAI_TRANSCRIPTION_INVALID_RESPONSE");
        }
        const language = transcriptionLanguage(result);
        return {
          text: typeof result.text === "string" ? result.text : "",
          ...(language ? { language } : {}),
        };
      }
    } catch (error) {
      lastError = error;
      const code = transcriptionErrorCode(error);
      const retryableNetworkFailure = code === "OPENAI_TRANSCRIPTION_TIMEOUT" || code === "OPENAI_TRANSCRIPTION_FAILED";
      if (!retryableNetworkFailure || attempt === maximumAttempts) throw new Error(code);
    }
  }

  throw new Error(transcriptionErrorCode(lastError));
}
