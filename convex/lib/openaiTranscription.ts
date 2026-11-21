export const NIGERIAN_SPEECH_PROMPT = "Na Nigerian WhatsApp voice note be this. Write wetin the person talk exactly as dem talk am. Keep Nigerian Pidgin, Nigerian English, names, and any code-switching as spoken. No translate and no correct the grammar. Common words fit include abeg, dey, no wahala, una, wetin, na, e, sabi, sha, abi, and oga.";

export function transcriptionLanguage(result: { language?: unknown; languages?: unknown }): string | undefined {
  if (Array.isArray(result.languages)) {
    const detected = result.languages.find((language): language is { code: string } =>
      typeof language === "object" && language !== null && typeof (language as { code?: unknown }).code === "string"
    );
    if (detected?.code.trim()) return detected.code.trim();
  }
  return typeof result.language === "string" && result.language.trim() ? result.language.trim() : undefined;
}

export function transcriptionHttpError(status: number): string {
  if (status === 401 || status === 403) return "OPENAI_TRANSCRIPTION_AUTH_FAILED";
  if (status === 413) return "AUDIO_SIZE_NOT_SUPPORTED";
  if (status === 429) return "OPENAI_TRANSCRIPTION_RATE_LIMITED";
  return `OPENAI_TRANSCRIPTION_HTTP_${status}`;
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
}): Promise<{ text: string; language?: string }> {
  const mimeType = args.audio.type.split(";")[0].trim().toLowerCase() || "audio/ogg";
  const form = new FormData();
  form.append("file", args.audio, args.fileName ?? `voice-note.${audioExtension(mimeType)}`);
  form.append("model", args.model);
  form.append("prompt", NIGERIAN_SPEECH_PROMPT);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(args.timeoutMs ?? 45_000),
  });
  if (!response.ok) throw new Error(transcriptionHttpError(response.status));
  const result = await response.json() as { text?: unknown; language?: unknown; languages?: unknown };
  return {
    text: typeof result.text === "string" ? result.text : "",
    ...(transcriptionLanguage(result) ? { language: transcriptionLanguage(result) } : {}),
  };
}
