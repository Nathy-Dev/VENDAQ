import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { identityDigest } from "../convex/lib/crypto";
import { createHarness, drain, message, tenant, webhook } from "./harness";

describe("authenticated WhatsApp ingestion", () => {
  it("commits before acknowledgement and collapses 100 duplicate deliveries", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const responses = await Promise.all(Array.from({ length: 100 }, () => webhook(harness, message(source))));
    expect(responses.every((response) => response.status === 202)).toBe(true);
    expect(await harness.run((ctx) => ctx.db.query("inboundEvents").collect())).toHaveLength(1);
    expect(await source.owner.query(api.foundation.customers, { businessId: source.businessId })).toHaveLength(0);
    await drain(harness);
    const contacts = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    expect(contacts).toHaveLength(1);
    const messages = await source.owner.query(api.foundation.messages, { businessId: source.businessId, customerId: contacts[0].customerId });
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("How much for this one?");
    const events = await harness.run((ctx) => ctx.db.query("inboundEvents").collect());
    expect(events[0].state).toBe("processed");
    expect(events[0].payload).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(source.token);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("2348000000001");
  });

  it("isolates identical message IDs across tenants and rejects mixed resource IDs", async () => {
    const harness = createHarness();
    const first = await tenant(harness);
    const second = await tenant(harness, "seller-two");
    await webhook(harness, message(first));
    await webhook(harness, message(second));
    await drain(harness);
    const contacts = await second.owner.query(api.foundation.customers, { businessId: second.businessId });
    await expect(first.owner.query(api.foundation.customers, { businessId: second.businessId })).rejects.toThrow("NOT_FOUND");
    await expect(first.owner.query(api.foundation.messages, { businessId: first.businessId, customerId: contacts[0].customerId })).rejects.toThrow("NOT_FOUND");
    await expect(first.owner.mutation(api.foundation.deleteCustomer, { businessId: first.businessId, customerId: contacts[0].customerId })).rejects.toThrow("NOT_FOUND");
    await expect(harness.query(api.foundation.workspace, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(harness.withIdentity({ subject: "google:seller-one", issuer: "https://attacker.test" }).query(api.foundation.workspace, {})).rejects.toThrow("UNAUTHENTICATED");
    expect(await harness.run((ctx) => ctx.db.query("customers").collect())).toHaveLength(2);
    const workspace = await first.owner.query(api.foundation.workspace, {});
    expect(JSON.stringify(workspace)).not.toMatch(/token|Ciphertext|instanceId|ownerId/);
  });

  it("requires the exact instance binding and token, never a display-name fallback", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    expect((await webhook(harness, { ...message(source), instanceToken: "wrong" })).status).toBe(401);
    expect((await webhook(harness, { ...message(source), instanceId: "unknown" })).status).toBe(401);
    expect((await webhook(harness, { ...message(source), instanceId: undefined, instance: source.instanceId })).status).toBe(401);
    expect(await harness.run((ctx) => ctx.db.query("inboundEvents").collect())).toHaveLength(0);
  });

  it("updates connected and disconnected state from authenticated webhooks without a manual refresh", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await harness.run((ctx) => ctx.db.patch(source.sessionId, { state: "disconnected" }));

    expect((await webhook(harness, { event: "Connected", instanceId: source.instanceId, instanceToken: source.token, data: {} })).status).toBe(202);
    expect((await source.owner.query(api.foundation.workspace, {}))?.state).toBe("connected");

    expect((await webhook(harness, { event: "Disconnected", instanceId: source.instanceId, instanceToken: source.token, data: {} })).status).toBe(202);
    expect((await source.owner.query(api.foundation.workspace, {}))?.state).toBe("disconnected");

    // A later event with the same provider event name belongs to a new state
    // cycle and must still update the live workspace even if its audit event
    // key matches the first Connected delivery.
    expect((await webhook(harness, { event: "Connected", instanceId: source.instanceId, instanceToken: source.token, data: {} })).status).toBe(202);
    expect((await source.owner.query(api.foundation.workspace, {}))?.state).toBe("connected");
  });

  it("stores casual and non-text messages, cancels either party's pending tasks, and keeps monotonic clocks", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source));
    await drain(harness);
    const [contact] = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    const initialTime = Date.now();
    for (const [index, content] of [{ conversation: "ok" }, { audioMessage: { url: "https://private-media.test" } }, { imageMessage: { caption: "payment proof" } }, { conversation: "Thank you" }].entries()) {
      const taskId = await harness.run((ctx) => ctx.db.insert("followUpTasks", { businessId: source.businessId, customerId: contact.customerId, reason: "buying_signal", status: "pending", dueAt: Date.now() + 60000, createdAt: initialTime - 1 }));
      await webhook(harness, message(source, { id: `reply-${index}`, fromMe: index === 3, content, at: initialTime + index }));
      await drain(harness);
      expect((await harness.run((ctx) => ctx.db.get(taskId)))?.status).toBe("cancelled");
    }
    await webhook(harness, message(source, { id: "older", at: initialTime - 500 }));
    await drain(harness);
    const customer = await harness.run((ctx) => ctx.db.get(contact.customerId));
    expect(customer?.lastInteraction).toBe(initialTime + 3);
    expect(customer?.lastOutboundAt).toBe(initialTime + 3);
    const stored = await source.owner.query(api.foundation.messages, { businessId: source.businessId, customerId: contact.customerId });
    expect(stored.filter((entry) => entry.manualReview)).toHaveLength(2);
    expect(JSON.stringify(stored)).not.toContain("private-media");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("captures only bounded audio metadata needed for transcription and never stores a provider media URL", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "voice-note-metadata");
    await webhook(harness, message(source, { id: "voice-1", content: { audioMessage: { url: "https://private-media.test/audio", mimetype: "audio/ogg; codecs=opus", mediaKey: "synthetic-key" } } }));
    await drain(harness);
    const [interaction] = await harness.run((ctx) => ctx.db.query("interactions").collect());
    expect(interaction).toMatchObject({ messageType: "audio", transcriptionState: "failed" });
    expect(JSON.stringify(interaction)).not.toContain("private-media.test");
    expect(interaction.mediaUrl).toBeUndefined();
  });

  it("transcribes a one-to-one voice note and replies through the authorized assistant path", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "voice-note-reply");
    const prompt = "You represent Voice Note Reply, a Nigerian retail business. Answer only with verified facts, never invent prices, stock, delivery details, payment information, discounts, or policies, ask one short clarifying question when information is missing, and reply in concise friendly WhatsApp language.";
    await source.owner.mutation(api.businessProfile.save, { businessId: source.businessId, systemPrompt: prompt, customerAutoReplyEnabled: true, groupAutoReplyEnabled: false });
    vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
    vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
    vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-provider-key");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    vi.stubEnv("OPENAI_TRANSCRIPTION_MODEL", "gpt-transcribe");
    vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
    vi.stubEnv("GROQ_LLM_MODEL", "synthetic-model");
    const requests: Array<{ url: string; body: BodyInit | null | undefined; headers: Headers }> = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body, headers: new Headers(init?.headers) });
      if (url.endsWith("/message/downloadmedia")) return Response.json({ data: { base64: Buffer.from("synthetic-ogg-audio").toString("base64"), mimetype: "audio/ogg" } });
      if (url === "https://api.openai.com/v1/audio/transcriptions") return Response.json({ text: "You get the blue shoes for size forty two? Abeg confirm.", languages: [{ code: "en" }] });
      if (url === "https://api.groq.com/openai/v1/chat/completions") return Response.json({ choices: [{ message: { content: "Yes, we can help with the blue shoes. Please confirm the style you want." } }] });
      if (url.endsWith("/message/presence")) return Response.json({ message: "success" });
      if (url.endsWith("/send/text")) return Response.json({ messageId: "provider-reply-1" });
      return new Response(null, { status: 404 });
    }));

    await webhook(harness, message(source, { id: "voice-reply-1", content: { audioMessage: { url: "https://private-media.test/audio", mimetype: "audio/ogg; codecs=opus", mediaKey: "synthetic-key" } } }));
    await drain(harness);

    const interactions = await harness.run((ctx) => ctx.db.query("interactions").collect());
    const inbound = interactions.find((interaction) => interaction.role === "customer");
    const outbound = interactions.find((interaction) => interaction.role === "owner");
    expect(inbound).toMatchObject({ messageType: "audio", transcriptionState: "completed", transcript: "You get the blue shoes for size forty two? Abeg confirm.", transcriptLanguage: "en", manualReviewRequired: false });
    expect(inbound?.transcriptConfidence).toBeUndefined();
    expect(outbound).toMatchObject({ content: "Yes, we can help with the blue shoes. Please confirm the style you want.", messageType: "text" });
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toEqual([expect.objectContaining({ interactionId: inbound!._id, state: "accepted", attempts: 1, providerMessageId: "provider-reply-1" })]);
    expect(requests.map((request) => request.url)).toEqual(expect.arrayContaining([
      "https://provider.example.test/message/downloadmedia",
      "https://api.openai.com/v1/audio/transcriptions",
      "https://api.groq.com/openai/v1/chat/completions",
      "https://provider.example.test/message/presence",
      "https://provider.example.test/send/text",
    ]));
    const transcriptionRequest = requests.find((request) => request.url === "https://api.openai.com/v1/audio/transcriptions")!;
    const transcriptionForm = transcriptionRequest.body as FormData;
    const transcriptionFile = transcriptionForm.get("file") as File;
    expect(transcriptionRequest.headers.get("authorization")).toBe("Bearer synthetic-openai-key");
    expect(transcriptionRequest.headers.has("content-type")).toBe(false);
    expect(transcriptionForm.get("model")).toBe("gpt-transcribe");
    expect(transcriptionForm.has("response_format")).toBe(false);
    expect(transcriptionForm.has("temperature")).toBe(false);
    expect(transcriptionForm.get("prompt")).toContain("Nigerian Pidgin");
    expect(transcriptionFile).toMatchObject({ name: "voice-note.ogg", type: "audio/ogg", size: Buffer.byteLength("synthetic-ogg-audio") });
    expect(JSON.parse(requests.find((request) => request.url.endsWith("/send/text"))!.body as string)).toMatchObject({ number: "2348000000001@s.whatsapp.net", text: outbound!.content, id: inbound!._id });
    expect(JSON.stringify(interactions)).not.toContain("private-media.test");
  });

  it("records a safe OpenAI status code and never guesses a reply when transcription fails", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "voice-note-provider-error");
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: "You represent Voice Note Provider Error, a Nigerian retail business. Only answer from verified business facts, never invent prices, stock, delivery details, discounts, payment information, or policies, and ask one short clarifying question when required information is missing.",
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
    });
    vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
    vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
    vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-provider-key");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    vi.stubEnv("OPENAI_TRANSCRIPTION_MODEL", "gpt-transcribe");
    vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/message/downloadmedia")) return Response.json({ data: { base64: Buffer.from("synthetic-ogg-audio").toString("base64"), mimetype: "audio/ogg" } });
      if (url === "https://api.openai.com/v1/audio/transcriptions") return Response.json({ error: { message: "private provider detail" } }, { status: 400 });
      return new Response(null, { status: 404 });
    }));

    await webhook(harness, message(source, { id: "voice-provider-error", content: { audioMessage: { url: "https://private-media.test/audio", mimetype: "audio/ogg; codecs=opus", mediaKey: "synthetic-key" } } }));
    await drain(harness);

    const interactions = await harness.run((ctx) => ctx.db.query("interactions").collect());
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({
      role: "customer",
      messageType: "audio",
      transcriptionState: "failed",
      transcriptionErrorCode: "OPENAI_TRANSCRIPTION_HTTP_400",
      manualReviewRequired: true,
    });
    expect(interactions[0].transcript).toBeUndefined();
    expect(JSON.stringify(interactions)).not.toContain("private provider detail");
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.map(([input]) => String(input))).not.toContain("https://provider.example.test/send/text");
  });

  it("automatically retries a temporarily rate-limited voice note and sends the reply", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "voice-note-rate-limit-retry");
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: "You represent Voice Retry, a Nigerian retail business. Only answer from verified business facts, never invent prices, stock, delivery details, discounts, payment information, or policies, and ask one short clarifying question when required information is missing.",
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
    });
    vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
    vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
    vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-provider-key");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    vi.stubEnv("OPENAI_TRANSCRIPTION_MODEL", "gpt-transcribe");
    vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
    vi.stubEnv("GROQ_LLM_MODEL", "synthetic-model");
    let transcriptionAttempts = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/message/downloadmedia")) return Response.json({ data: { base64: Buffer.from("synthetic-ogg-audio").toString("base64"), mimetype: "audio/ogg" } });
      if (url === "https://api.openai.com/v1/audio/transcriptions") {
        transcriptionAttempts += 1;
        if (transcriptionAttempts === 1) return Response.json({ error: { type: "rate_limit_error", message: "private provider detail" } }, { status: 429 });
        return Response.json({ text: "Abeg, do you deliver to Abuja?", language: "en" });
      }
      if (url === "https://api.groq.com/openai/v1/chat/completions") return Response.json({ choices: [{ message: { content: "Yes, we can help. Please share your exact Abuja location so we can confirm delivery." } }] });
      if (url.endsWith("/message/presence")) return Response.json({ message: "success" });
      if (url.endsWith("/send/text")) return Response.json({ messageId: "provider-reply-rate-retry" });
      return new Response(null, { status: 404 });
    }));

    await webhook(harness, message(source, { id: "voice-rate-retry", content: { audioMessage: { url: "https://private-media.test/audio", mimetype: "audio/ogg; codecs=opus", mediaKey: "synthetic-key" } } }));
    await drain(harness);

    const interactions = await harness.run((ctx) => ctx.db.query("interactions").collect());
    expect(transcriptionAttempts).toBe(2);
    expect(interactions.find((interaction) => interaction.role === "customer")).toMatchObject({
      transcriptionState: "completed",
      transcript: "Abeg, do you deliver to Abuja?",
    });
    expect(interactions.find((interaction) => interaction.role === "owner")).toMatchObject({
      content: "Yes, we can help. Please share your exact Abuja location so we can confirm delivery.",
    });
  });

  it("analyzes a one-to-one image privately and replies through the authorized assistant path", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "image-reply");
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: "You represent Image Reply, a Nigerian fashion business. Answer only from verified business facts and the factual image analysis, never invent prices, stock, delivery details, discounts, payment confirmation, or policies, and ask one short clarifying question when needed.",
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
    });
    vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
    vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
    vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-provider-key");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    vi.stubEnv("OPENAI_VISION_MODEL", "synthetic-vision-model");
    vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
    vi.stubEnv("GROQ_LLM_MODEL", "synthetic-model");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    const requests: Array<{ url: string; body: BodyInit | null | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body });
      if (url.endsWith("/message/downloadmedia")) return Response.json({ data: { base64: png.toString("base64"), mimetype: "image/png" } });
      if (url === "https://api.openai.com/v1/responses") return Response.json({ output: [{ content: [{ type: "output_text", text: "A blue short-sleeve shirt is shown. No price is visible. The customer appears to be asking about this product." }] }] });
      if (url === "https://api.groq.com/openai/v1/chat/completions") return Response.json({ choices: [{ message: { content: "Yes, that is a blue short-sleeve shirt. Which size would you like?" } }] });
      if (url.endsWith("/message/presence")) return Response.json({ message: "success" });
      if (url.endsWith("/send/text")) return Response.json({ messageId: "provider-image-reply-1" });
      return new Response(null, { status: 404 });
    }));

    await webhook(harness, message(source, { id: "image-reply-1", content: { imageMessage: { URL: "https://private-media.test/image", directPath: "/private/image", mimetype: "image/png", mediaKey: [1, 2, 3, 4], fileEncSHA256: [5, 6, 7], fileSHA256: [8, 9, 10], caption: "Do you have this?" } } }));
    await drain(harness);

    const interactions = await harness.run((ctx) => ctx.db.query("interactions").collect());
    const inbound = interactions.find((interaction) => interaction.role === "customer");
    const outbound = interactions.find((interaction) => interaction.role === "owner");
    expect(inbound).toMatchObject({
      messageType: "image",
      imageAnalysisState: "completed",
      imageAnalysis: "A blue short-sleeve shirt is shown. No price is visible. The customer appears to be asking about this product.",
      manualReviewRequired: false,
    });
    expect(inbound?.content).toContain("Customer caption: Do you have this?");
    expect(outbound).toMatchObject({ content: "Yes, that is a blue short-sleeve shirt. Which size would you like?", messageType: "text" });
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toEqual([expect.objectContaining({ interactionId: inbound!._id, state: "accepted", providerMessageId: "provider-image-reply-1" })]);
    const visionRequest = requests.find((request) => request.url === "https://api.openai.com/v1/responses")!;
    const providerDownloadRequest = requests.find((request) => request.url.endsWith("/message/downloadmedia"))!;
    expect(JSON.parse(providerDownloadRequest.body as string)).toEqual({ message: { imageMessage: { URL: "https://private-media.test/image", directPath: "/private/image", mediaKey: [1, 2, 3, 4], mimetype: "image/png", fileEncSHA256: [5, 6, 7], fileSHA256: [8, 9, 10] } } });
    const visionBody = JSON.parse(visionRequest.body as string);
    expect(visionBody).toMatchObject({ model: "synthetic-vision-model", input: [{ role: "user", content: [{ type: "input_text" }, { type: "input_image", detail: "low" }] }] });
    expect(visionBody.input[0].content[1].image_url).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(requests.map((request) => request.url)).toEqual(expect.arrayContaining([
      "https://provider.example.test/message/downloadmedia",
      "https://api.openai.com/v1/responses",
      "https://api.groq.com/openai/v1/chat/completions",
      "https://provider.example.test/message/presence",
      "https://provider.example.test/send/text",
    ]));
    expect(JSON.stringify(interactions)).not.toContain("private-media.test");
    expect(JSON.stringify(interactions)).not.toContain(png.toString("base64"));
  });

  it("keeps failed image analysis in manual review and never guesses a reply", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "image-provider-error");
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: "You represent Image Provider Error, a Nigerian business. Only answer from verified facts, never invent prices, stock, delivery details, discounts, payment confirmation, or policies, and ask one short clarifying question when needed.",
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
    });
    vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
    vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
    vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-provider-key");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    vi.stubEnv("OPENAI_VISION_MODEL", "synthetic-vision-model");
    vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/message/downloadmedia")) return Response.json({ data: { base64: png.toString("base64"), mimetype: "image/png" } });
      if (url === "https://api.openai.com/v1/responses") return Response.json({ error: { message: "private provider detail" } }, { status: 400 });
      return new Response(null, { status: 404 });
    }));

    await webhook(harness, message(source, { id: "image-provider-error", content: { imageMessage: { url: "https://private-media.test/image", mimetype: "image/png", mediaKey: "synthetic-image-key", caption: "How much?" } } }));
    await drain(harness);

    const interactions = await harness.run((ctx) => ctx.db.query("interactions").collect());
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({ role: "customer", messageType: "image", imageAnalysisState: "failed", imageAnalysisErrorCode: "OPENAI_IMAGE_HTTP_400", manualReviewRequired: true });
    expect(interactions[0].imageAnalysis).toBeUndefined();
    expect(JSON.stringify(interactions)).not.toContain("private provider detail");
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toHaveLength(0);
    const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(calls).not.toContain("https://api.groq.com/openai/v1/chat/completions");
    expect(calls).not.toContain("https://provider.example.test/send/text");
  });

  it("does not analyze images from groups that are not individually enabled", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "disabled-group-image");
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: "You represent Disabled Group Image, a Nigerian business. Only reply in WhatsApp groups the owner has individually enabled, and answer only from verified business facts without inventing prices, stock, delivery details, payment confirmation, or policies.",
      customerAutoReplyEnabled: false,
      groupAutoReplyEnabled: true,
    });
    vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
    vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
    vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-provider-key");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    vi.stubEnv("OPENAI_VISION_MODEL", "synthetic-vision-model");
    await webhook(harness, message(source, {
      id: "disabled-group-image",
      chat: "12345@g.us",
      name: "Participant",
      info: { IsGroup: true, IsMention: true, SenderAlt: "2348111111111@s.whatsapp.net" },
      data: { groupData: { Name: "Disabled Image Group" } },
      content: { imageMessage: { url: "https://private-media.test/group-image", mimetype: "image/png", mediaKey: "synthetic-image-key", caption: "Do you sell this?" } },
    }));
    await drain(harness);

    const [interaction] = await harness.run((ctx) => ctx.db.query("interactions").collect());
    expect(interaction).toMatchObject({ messageType: "image", isGroup: true, manualReviewRequired: true });
    expect(interaction.imageAnalysisState).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toHaveLength(0);
  });

  it("canonicalizes private LID messages and names group threads from group metadata", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source, { id: "lid-inbound", chat: "12345@lid", info: { SenderAlt: "2348000000001@s.whatsapp.net" } }));
    await webhook(harness, message(source, { id: "phone-inbound", chat: "2348000000001@s.whatsapp.net" }));
    await webhook(harness, message(source, { id: "group-message", chat: "12345@g.us", name: "First Participant", info: { IsGroup: true }, data: { groupData: { Name: "Market Community" } } }));
    await webhook(harness, { event: "Receipt", instanceId: source.instanceId, instanceToken: source.token, state: "Read", data: { Chat: "status@broadcast", Sender: "56789@lid", MessageIDs: ["status-1", "status-2"], Timestamp: new Date().toISOString() } });
    await drain(harness);
    expect(await harness.run((ctx) => ctx.db.query("customers").collect())).toHaveLength(2);
    const contacts = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    expect(contacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity: "2348000000001@s.whatsapp.net", name: "Synthetic Buyer" }),
      expect.objectContaining({ identity: "12345@g.us", name: "Market Community" }),
    ]));
    const observations = await harness.run((ctx) => ctx.db.query("statusObservations").collect());
    expect(observations).toHaveLength(0);
    const groups = await harness.run((ctx) => ctx.db.query("managedGroups").collect());
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ groupJid: "12345@g.us", groupName: "Market Community", isEnabled: false, mentionOnly: true });
    const tasks = await harness.run((ctx) => ctx.db.query("followUpTasks").collect());
    expect(tasks).toHaveLength(1);
    expect(tasks.every((task) => task.reason === "buying_signal" && task.triggerInteractionId !== undefined)).toBe(true);
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps owner messages on their recipient thread when SenderAlt is the owner's LID", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source, { id: "owner-lid-message", chat: "2348111111111@s.whatsapp.net", fromMe: true, info: { SenderAlt: "987654321@lid" }, name: "Owner" }));
    await drain(harness);
    const contacts = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    expect(contacts).toHaveLength(1);
    expect(contacts[0].identity).toBe("2348111111111@s.whatsapp.net");
  });

  it("combines existing LID and phone histories and prioritizes the saved contact name", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source, { id: "lid-history", chat: "99999@lid", name: "Push Name" }));
    await webhook(harness, message(source, { id: "phone-history", chat: "2348999999999@s.whatsapp.net", name: "Other Push Name" }));
    await drain(harness);
    const canonicalIdentityKey = await identityDigest(source.businessId, "2348999999999@s.whatsapp.net");
    await harness.mutation(internal.directorySync.apply, {
      businessId: source.businessId,
      contacts: [{ jid: "2348999999999@s.whatsapp.net", name: "Saved Contact" }],
      mappings: [{ canonicalJid: "2348999999999@s.whatsapp.net", canonicalIdentityKey, aliases: ["99999@lid", "2348999999999@s.whatsapp.net"] }],
      groups: [],
    });
    const contacts = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ name: "Saved Contact", identity: "2348999999999@s.whatsapp.net" });
    const messages = await source.owner.query(api.foundation.messages, { businessId: source.businessId, customerId: contacts[0].customerId });
    expect(messages).toHaveLength(2);
  });

  it("bounds payloads and quarantines authenticated malformed events without raw content", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    expect((await harness.fetch("/api/webhook/evolution", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status).toBe(400);
    expect((await webhook(harness, { padding: "x".repeat(262144) })).status).toBe(413);
    const malformed = message(source);
    malformed.data.Info.Timestamp = "invalid-private-timestamp";
    expect((await webhook(harness, malformed)).status).toBe(202);
    const [event] = await harness.run((ctx) => ctx.db.query("inboundEvents").collect());
    expect(event.state).toBe("dead_letter");
    expect(event.errorCode).toBe("INVALID_TIMESTAMP");
    expect(event.payload).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("invalid-private-timestamp");
    expect((await harness.fetch("/api/worker", { method: "POST" })).status).toBe(410);
  });
});
