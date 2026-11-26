import { describe, expect, it, vi } from "vitest";
import { createThread, listMessages, saveMessages } from "@convex-dev/agent";
import { register as registerAgent } from "@convex-dev/agent/test";
import { api, components, internal } from "../convex/_generated/api";
import { aiTenant, createHarness, drain, message, tenant, webhook, type Harness } from "./harness";

const gateway = vi.hoisted(() => ({ doGenerate: vi.fn() }));
vi.mock("@convex-dev/ai-sdk-provider", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  return { convexGateway: () => new MockLanguageModelV4({ doGenerate: gateway.doGenerate }) };
});

type Tenant = Awaited<ReturnType<typeof tenant>>;
const groupJid = "120000000555@g.us";
const systemPrompt = "You represent a Nigerian retail business. Answer only from verified business facts, never invent prices, stock, delivery dates, payment details, or policies, and refer uncertain requests to the owner. Use concise WhatsApp replies.";
const directMedia = {
  audio: { audioMessage: { url: "https://private-media.test/voice", mimetype: "audio/ogg", mediaKey: "synthetic-key" } },
  image: { imageMessage: { url: "https://private-media.test/image", mimetype: "image/png", mediaKey: "synthetic-key", caption: "How much for the blue shirt?" } },
};

const setAI = (source: Tenant, enabled: boolean) => source.owner.mutation(api.businessProfile.setAssistantEnabled, { businessId: source.businessId, enabled });
const configureReplies = (source: Tenant, group = false) => source.owner.mutation(api.businessProfile.save, { businessId: source.businessId, systemPrompt, customerAutoReplyEnabled: true, groupAutoReplyEnabled: group, leadQualificationEnabled: false });

function enableMockProviders() {
  vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
  vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
  vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-provider-key");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
  vi.stubEnv("OPENAI_TRANSCRIPTION_MODEL", "gpt-transcribe");
  vi.stubEnv("OPENAI_VISION_MODEL", "synthetic-vision-model");
  vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
  vi.stubEnv("GROQ_LLM_MODEL", "synthetic-chat-model");
  vi.stubEnv("CONVEX_AI_GATEWAY_MODEL", "");
}

async function assertNoAutomation(harness: Harness) {
  for (const table of ["aiActivityLog", "assistantDispatches", "communityOpportunities", "commerceExceptions", "conversationCommitments", "followUpTasks", "leadQualifications", "missedRevenueOpportunities", "ownerRescueRequests", "paymentProofs"] as const) {
    expect(await harness.run((ctx) => ctx.db.query(table).take(1)), table).toEqual([]);
  }
}

describe("AI Assistant pause", () => {
  it("syncs direct and group text, attachment notices, and human replies without analyzing, downloading, or sending", async () => {
    enableMockProviders();
    const harness = createHarness();
    const source = await aiTenant(harness);
    await configureReplies(source, true);
    await harness.mutation(internal.groups.upsertFromProvider, { businessId: source.businessId, groups: [{ jid: groupJid, name: "Sales group", memberCount: 20, role: "admin" }] });
    await source.owner.mutation(api.groups.setEnabled, { businessId: source.businessId, groupJid, isEnabled: true });
    await setAI(source, false);

    for (const scope of ["direct", "group"] as const) {
      for (const [kind, content] of Object.entries({ text: { conversation: "How much? I can pay tomorrow." }, ...directMedia })) {
        const result = await webhook(harness, message(source, { id: `${scope}-${kind}`, content, ...(scope === "group" ? { chat: groupJid, info: { IsGroup: true, IsBotMentioned: true, Sender: "2348000000042@s.whatsapp.net" } } : {}) }));
        expect(result.status).toBe(202);
      }
    }
    await webhook(harness, message(source, { id: "seller-reply", fromMe: true, content: { conversation: "I can help over WhatsApp." } }));
    const events = await harness.run((ctx) => ctx.db.query("inboundEvents").collect());
    expect(events).toHaveLength(7);
    for (const event of events) expect(event.aiProcessingEpoch).toBeNull();
    expect(JSON.stringify(events)).not.toMatch(/private-media\.test|synthetic-key|mediaPayload/);

    await drain(harness);
    const contacts = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    expect(contacts).toHaveLength(2);
    for (const contact of contacts) {
      const inbox = await source.owner.query(api.foundation.messages, { businessId: source.businessId, customerId: contact.customerId });
      expect(inbox).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "How much? I can pay tomorrow." }),
        expect.objectContaining({ type: "audio", manualReview: true, transcriptionState: null, transcript: null }),
        expect.objectContaining({ type: "image", text: "How much for the blue shirt?", manualReview: true, imageAnalysisState: null }),
      ]));
      if (!contact.isGroup) expect(inbox).toContainEqual(expect.objectContaining({ role: "owner", assistantGenerated: false, text: "I can help over WhatsApp." }));
    }
    const interactions = await harness.run((ctx) => ctx.db.query("interactions").collect());
    expect(interactions).toHaveLength(7);
    for (const interaction of interactions) {
      expect(interaction.aiProcessingEpoch).toBeNull();
      expect(interaction.classifierLabel).toBeUndefined();
      expect(interaction.classifiedAt).toBeUndefined();
    }
    await assertNoAutomation(harness);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still honors exact consent keywords while paused", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source, { id: "opt-in", content: { conversation: "START" } }));
    await drain(harness);
    vi.setSystemTime(Date.now() + 1_000);
    await webhook(harness, message(source, { id: "opt-out", content: { conversation: "STOP" } }));
    await drain(harness);
    const [customer] = await harness.run((ctx) => ctx.db.query("customers").collect());
    expect(customer.communicationState).toBe("opted_out");
    const consents = await harness.run((ctx) => ctx.db.query("communicationConsents").collect());
    expect(consents).toContainEqual(expect.objectContaining({ scope: "marketing", state: "granted", evidence: "START" }));
    expect(consents).toContainEqual(expect.objectContaining({ scope: "marketing", state: "withdrawn", evidence: "STOP" }));
    await assertNoAutomation(harness);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not backfill queued, delayed, or replayed messages after enabling again", async () => {
    enableMockProviders();
    const harness = createHarness();
    const source = await aiTenant(harness);
    const queuedWhenOn = message(source, { id: "queued-on", content: directMedia.image });
    expect((await webhook(harness, queuedWhenOn)).status).toBe(202);
    await setAI(source, false);
    vi.setSystemTime(Date.now() + 1_000);
    const queuedWhenOff = message(source, { id: "queued-off", content: directMedia.audio });
    const delayedWhenOff = message(source, { id: "delayed-off" });
    expect((await webhook(harness, queuedWhenOff)).status).toBe(202);

    vi.setSystemTime(Date.now() + 1_000);
    await setAI(source, true);
    expect((await webhook(harness, message(source, { id: "ambiguous-cutoff" }))).status).toBe(202);
    expect((await webhook(harness, delayedWhenOff)).status).toBe(202);
    expect(await (await webhook(harness, queuedWhenOff)).json()).toMatchObject({ duplicate: true });
    expect(await (await webhook(harness, queuedWhenOn)).json()).toMatchObject({ duplicate: true });
    await drain(harness);
    const stale = await harness.run((ctx) => ctx.db.query("interactions").collect());
    expect(stale).toHaveLength(4);
    for (const interaction of stale) expect(interaction.aiProcessingEpoch).toBeNull();
    await assertNoAutomation(harness);
    expect(fetch).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 1_000);
    await webhook(harness, message(source, { id: "fresh-on" }));
    await drain(harness);
    const fresh = await harness.run(async (ctx) => (await ctx.db.query("interactions").collect()).find((entry) => entry.whatsappMessageId === "fresh-on"));
    expect(fresh).toMatchObject({ aiProcessingEpoch: expect.any(Number), classifierLabel: "buying_signal" });
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["Groq", "Gateway"] as const)("uses only eligible inbox history for %s", async (provider) => {
    enableMockProviders();
    const harness = createHarness();
    const source = await tenant(harness);
    const manualText = "Manual-only customer detail";
    const manualReply = "Manual-only seller reply";
    const legacyText = "Unmarked legacy inbox message";
    const threadText = "Historic Agent thread content";
    const eligibleText = "Eligible earlier message";
    const currentText = "Current customer question";
    const reply = "Thanks for your message. How can we help?";

    await webhook(harness, message(source, { id: "manual-customer", content: { conversation: manualText } }));
    await webhook(harness, message(source, { id: "manual-owner", fromMe: true, content: { conversation: manualReply } }));
    await drain(harness);
    const [contact] = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    const [conversation] = await harness.run((ctx) => ctx.db.query("conversations").collect());

    vi.setSystemTime(Date.now() + 1_000);
    await setAI(source, true);
    vi.setSystemTime(Date.now() + 1_000);
    await harness.run((ctx) => ctx.db.insert("interactions", {
      businessId: source.businessId, customerId: contact.customerId, conversationId: conversation._id, role: "customer", content: legacyText, timestamp: Date.now(),
    }));
    await webhook(harness, message(source, { id: "eligible-history", content: { conversation: eligibleText } }));
    await drain(harness);
    await configureReplies(source);

    let providerPrompt = "";
    let threadId: string | undefined;
    if (provider === "Gateway") {
      registerAgent(harness);
      vi.stubEnv("CONVEX_AI_GATEWAY_MODEL", "synthetic-gateway-model");
      threadId = await harness.run(async (ctx) => {
        const userId = `business:${source.businessId}:customer:${contact.customerId}`;
        const threadId = await createThread(ctx, components.agent, { userId });
        await saveMessages(ctx, components.agent, { threadId, userId, messages: [{ role: "user", content: threadText }] });
        await ctx.db.patch(conversation._id, { agentThreadId: threadId });
        return threadId;
      });
      gateway.doGenerate.mockReset().mockImplementation(async ({ prompt }) => {
        providerPrompt = JSON.stringify(prompt);
        return {
          content: [{ type: "text", text: reply }], finishReason: { unified: "stop", raw: "stop" }, warnings: [],
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        };
      });
    }
    vi.stubGlobal("fetch", vi.fn(async (input, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/openai/v1/chat/completions" && provider === "Groq") {
        providerPrompt = String(init?.body);
        return Response.json({ choices: [{ message: { content: reply } }] });
      }
      if (path === "/message/presence") return Response.json({ message: "success" });
      if (path === "/send/text") return Response.json({ messageId: "synthetic-reply-id" });
      throw new Error("UNEXPECTED_PROVIDER_CALL");
    }));

    vi.setSystemTime(Date.now() + 1_000);
    await webhook(harness, message(source, { id: "current-customer", content: { conversation: currentText } }));
    await drain(harness);
    expect(providerPrompt).toContain(eligibleText);
    expect(providerPrompt).toContain(currentText);
    for (const forbidden of [manualText, manualReply, legacyText, threadText]) expect(providerPrompt).not.toContain(forbidden);
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toEqual([expect.objectContaining({ state: "accepted", content: reply })]);
    if (threadId) {
      const messages = await harness.run((ctx) => listMessages(ctx, components.agent, { threadId, paginationOpts: { numItems: 5, cursor: null } }));
      expect(messages.page).toHaveLength(1);
      expect(messages.page[0].message).toMatchObject({ content: threadText });
    }
  });

  it.each([
    { kind: "audio", pauseAt: "download" },
    { kind: "audio", pauseAt: "analysis" },
    { kind: "image", pauseAt: "analysis" },
  ] as const)("drops revoked $kind processing during $pauseAt", async ({ kind, pauseAt }) => {
    enableMockProviders();
    const harness = createHarness();
    const source = await aiTenant(harness);
    await configureReplies(source);
    const paths: string[] = [];
    const pauseAndResume = async () => {
      await setAI(source, false);
      vi.setSystemTime(Date.now() + 1_000);
      await setAI(source, true);
    };
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path === "/message/downloadmedia") {
        if (pauseAt === "download") await pauseAndResume();
        const bytes = kind === "audio" ? Buffer.from("synthetic-ogg-audio") : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        return Response.json({ data: { base64: bytes.toString("base64"), mimetype: kind === "audio" ? "audio/ogg" : "image/png" } });
      }
      if (path === "/v1/audio/transcriptions" || path === "/v1/responses") {
        await pauseAndResume();
        const result = "The customer wants to order the blue shirts.";
        return Response.json(kind === "audio" ? { text: result } : { output: [{ content: [{ type: "output_text", text: result }] }] });
      }
      throw new Error("UNEXPECTED_PROVIDER_CALL");
    }));

    await webhook(harness, message(source, { content: directMedia[kind] }));
    await drain(harness);
    expect(paths).toEqual(pauseAt === "download" ? ["/message/downloadmedia"] : ["/message/downloadmedia", kind === "audio" ? "/v1/audio/transcriptions" : "/v1/responses"]);
    const [interaction] = await harness.run((ctx) => ctx.db.query("interactions").collect());
    expect(interaction).toMatchObject({ manualReviewRequired: true, messageType: kind });
    expect(interaction.transcript).toBeUndefined();
    expect(interaction.transcriptionState).toBeUndefined();
    expect(interaction.imageAnalysis).toBeUndefined();
    expect(interaction.imageAnalysisState).toBeUndefined();
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toEqual([]);
  });

  it.each(["model", "typing"] as const)("stops a send when AI is disabled during %s", async (pauseAt) => {
    enableMockProviders();
    const harness = createHarness();
    const source = await aiTenant(harness);
    await configureReplies(source);
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path === "/openai/v1/chat/completions") {
        if (pauseAt === "model") await setAI(source, false);
        return Response.json({ choices: [{ message: { content: "Thanks for your message. How can we help?" } }] });
      }
      if (path === "/message/presence") {
        await setAI(source, false);
        return Response.json({ message: "success" });
      }
      throw new Error("UNEXPECTED_PROVIDER_CALL");
    }));

    await webhook(harness, message(source, { content: { conversation: "Hello, are you open today?" } }));
    await drain(harness);
    expect(paths).toEqual(pauseAt === "model" ? ["/openai/v1/chat/completions"] : ["/openai/v1/chat/completions", "/message/presence"]);
    const dispatches = await harness.run((ctx) => ctx.db.query("assistantDispatches").collect());
    expect(dispatches).toEqual(pauseAt === "model" ? [] : [expect.objectContaining({ state: "cancelled", errorCode: "AUTHORIZATION_REVOKED_DURING_TYPING" })]);
  });

  it("lets only the owner change the master switch and does not re-enable through a playbook save", async () => {
    const harness = createHarness();
    const source = await aiTenant(harness);
    const other = await tenant(harness, "another-owner");
    await configureReplies(source, true);
    const args = { businessId: source.businessId, enabled: false };
    await expect(other.owner.mutation(api.businessProfile.setAssistantEnabled, args)).rejects.toThrow("NOT_FOUND");
    await expect(harness.mutation(api.businessProfile.setAssistantEnabled, args)).rejects.toThrow("UNAUTHENTICATED");
    expect(await source.owner.query(api.businessProfile.get, { businessId: source.businessId })).toMatchObject({ aiEnabled: true });
    await setAI(source, false);
    await configureReplies(source, true);
    expect(await source.owner.query(api.businessProfile.get, { businessId: source.businessId })).toMatchObject({ aiEnabled: false, customerAutoReplyEnabled: true, groupAutoReplyEnabled: true });
    expect(await source.owner.query(api.foundation.workspace, {})).toMatchObject({ aiEnabled: false, launchReady: false });
  });

  it("preserves an off request from a cached client without letting it enable AI", async () => {
    const harness = createHarness();
    const source = await aiTenant(harness);
    await configureReplies(source, true);
    const args = { businessId: source.businessId, systemPrompt, customerAutoReplyEnabled: false, groupAutoReplyEnabled: false };
    await source.owner.mutation(api.businessProfile.save, { ...args, assistantSettingsVersion: 2 });
    expect(await source.owner.query(api.businessProfile.get, { businessId: source.businessId })).toMatchObject({ aiEnabled: true, customerAutoReplyEnabled: false, groupAutoReplyEnabled: false });

    await configureReplies(source, true);
    await webhook(harness, message(source, { id: "before-legacy-pause" }));
    await source.owner.mutation(api.businessProfile.save, args);
    await configureReplies(source, true);
    await drain(harness);

    expect(await source.owner.query(api.businessProfile.get, { businessId: source.businessId })).toMatchObject({ aiEnabled: false });
    expect(await harness.run((ctx) => ctx.db.query("interactions").take(2))).toEqual([expect.objectContaining({ whatsappMessageId: "before-legacy-pause", aiProcessingEpoch: null })]);
    await assertNoAutomation(harness);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows revocation in billing read-only mode but never grants new access", async () => {
    const harness = createHarness();
    const source = await aiTenant(harness);
    await configureReplies(source);
    await harness.run(async (ctx) => {
      const subscription = await ctx.db.query("businessSubscriptions").withIndex("by_business", (builder) => builder.eq("businessId", source.businessId)).unique();
      await ctx.db.patch(subscription!._id, { status: "expired", trialEndsAt: Date.now() - 1, currentPeriodEnd: Date.now() - 1 });
    });

    await setAI(source, false);
    await expect(setAI(source, true)).rejects.toThrow("BILLING_UPGRADE_REQUIRED");
    expect(await source.owner.query(api.businessProfile.get, { businessId: source.businessId })).toMatchObject({ aiEnabled: false, customerAutoReplyEnabled: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
