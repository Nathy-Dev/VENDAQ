import { describe, expect, it, vi } from "vitest";
import { createHarness, tenant } from "./harness";

const description = "We sell handmade shoes in Lagos, deliver nationwide, accept bank transfers, confirm stock before payment, and escalate refunds to the owner.";

describe("Business AI brief HTTP flows", () => {
  it("transcribes an authenticated business recording with the configured GPT transcription model", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "voice-business-brief");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    vi.stubEnv("OPENAI_TRANSCRIPTION_MODEL", "gpt-transcribe");
    let requestForm: FormData | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input, init?: RequestInit) => {
      if (String(input) === "https://api.openai.com/v1/audio/transcriptions") {
        requestForm = init?.body as FormData;
        return Response.json({ text: "We sell handmade shoes for Lagos and deliver nationwide.", language: "en" });
      }
      return new Response(null, { status: 404 });
    }));
    const form = new FormData();
    form.append("businessId", source.businessId);
    form.append("recording", new Blob([new Uint8Array(1_024)], { type: "audio/webm" }), "business-description.webm");

    const response = await source.owner.fetch("/api/business-ai/transcribe", {
      method: "POST",
      headers: { Origin: "https://auth.example.test" },
      body: form,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ transcript: "We sell handmade shoes for Lagos and deliver nationwide.", language: "en" });
    expect(requestForm?.get("model")).toBe("gpt-transcribe");
    expect(String(requestForm?.get("prompt"))).toContain("Nigerian Pidgin");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://auth.example.test");
  });

  it("retries a transient transcription 502 and succeeds without another user recording", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "voice-business-brief-retry");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    vi.stubEnv("OPENAI_TRANSCRIPTION_MODEL", "gpt-transcribe");
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input) => {
      if (String(input) !== "https://api.openai.com/v1/audio/transcriptions") return new Response(null, { status: 404 });
      attempts += 1;
      if (attempts === 1) return Response.json({ error: { message: "temporary upstream failure" } }, { status: 502 });
      return Response.json({ text: "We sell ready to wear clothes and deliver across Nigeria.", language: "en" });
    }));
    const form = new FormData();
    form.append("businessId", source.businessId);
    form.append("recording", new Blob([new Uint8Array(1_024)], { type: "audio/webm" }), "business-description.webm");

    const response = await source.owner.fetch("/api/business-ai/transcribe", {
      method: "POST",
      headers: { Origin: "https://auth.example.test" },
      body: form,
    });

    expect(response.status).toBe(200);
    expect(attempts).toBe(2);
    expect(await response.json()).toMatchObject({ transcript: "We sell ready to wear clothes and deliver across Nigeria." });
  });

  it("returns a safe error code after bounded retries when transcription remains unavailable", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "voice-business-brief-permanent-error");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    vi.stubEnv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-transcribe");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "private upstream detail" } }, { status: 502 })));
    const form = new FormData();
    form.append("businessId", source.businessId);
    form.append("recording", new Blob([new Uint8Array(1_024)], { type: "audio/webm" }), "business-description.webm");

    const response = await source.owner.fetch("/api/business-ai/transcribe", {
      method: "POST",
      headers: { Origin: "https://auth.example.test" },
      body: form,
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "OPENAI_TRANSCRIPTION_HTTP_502" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("streams only the generated prompt text from the provider response", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "stream-business-brief");
    vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
    vi.stubEnv("GROQ_LLM_MODEL", "synthetic-model");
    let requestBody: { stream?: boolean; messages?: Array<{ content?: string }> } | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input, init?: RequestInit) => {
      if (String(input) !== "https://api.groq.com/openai/v1/chat/completions") return new Response(null, { status: 404 });
      requestBody = JSON.parse(String(init?.body));
      return new Response([
        'data: {"choices":[{"delta":{"content":"You represent Stream Business Brief. "}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"Use only verified business facts and never invent prices, stock, delivery dates, payment details, or policies. "}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"Ask one short clarifying question when information is missing and escalate refunds to the owner."}}]}',
        '',
        "data: [DONE]",
        "",
      ].join("\n"), { headers: { "Content-Type": "text/event-stream" } });
    }));

    const response = await source.owner.fetch("/api/business-ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://auth.example.test" },
      body: JSON.stringify({ businessId: source.businessId, businessDescription: description }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toContain("You represent Stream Business Brief");
    expect(text).toContain("escalate refunds to the owner");
    expect(text).not.toContain("data:");
    expect(requestBody?.stream).toBe(true);
    expect(requestBody?.messages?.at(-1)?.content).toContain(description);
  });

  it("does not let one business generate from another business ID", async () => {
    const harness = createHarness();
    const first = await tenant(harness, "first-business-owner");
    const second = await tenant(harness, "second-business-owner");
    vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
    vi.stubEnv("GROQ_LLM_MODEL", "synthetic-model");

    const response = await first.owner.fetch("/api/business-ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://auth.example.test" },
      body: JSON.stringify({ businessId: second.businessId, businessDescription: description }),
    });

    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects cross-origin preflight requests outside the configured app origin", async () => {
    const harness = createHarness();
    const response = await harness.fetch("/api/business-ai/generate", {
      method: "OPTIONS",
      headers: { Origin: "https://malicious.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate limits paid prompt generation per business", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "rate-limited-business-brief");
    vi.stubEnv("BUSINESS_AI_PROMPT_GENERATIONS_PER_HOUR", "1");
    vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
    vi.stubEnv("GROQ_LLM_MODEL", "synthetic-model");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"You represent Rate Limited Business. Use verified facts only, ask concise questions when details are missing, and escalate uncertain requests to the owner."}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n"))));
    const request = () => source.owner.fetch("/api/business-ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://auth.example.test" },
      body: JSON.stringify({ businessId: source.businessId, businessDescription: description }),
    });

    expect((await request()).status).toBe(200);
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3600");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
