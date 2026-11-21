import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { assistantReplyDelayMs } from "../convex/lib/launch";
import { normalizeAssistantReply } from "../convex/lib/assistantStyle";
import { createHarness, tenant } from "./harness";

const directPrompt = "You represent Launch Safety, a Nigerian retail business. Answer only with verified facts from this system prompt, never invent prices, stock, delivery dates, policies, discounts, or payment details, ask one short clarifying question when information is missing, and escalate complaints, refunds, and uncertain requests to the owner using concise friendly WhatsApp language.";

async function inboundInteraction(
  harness: ReturnType<typeof createHarness>,
  source: Awaited<ReturnType<typeof tenant>>,
  options: { content?: string; isGroup?: boolean; wasMentioned?: boolean; target?: string; classifierLabel?: "buying_signal" | "inquiry" | "payment_related" | "casual_noise" | "manual_review" } = {},
) {
  const now = Date.now();
  return await harness.run(async (ctx) => {
    const target = options.target ?? (options.isGroup ? "120000000099@g.us" : "2348000000099@s.whatsapp.net");
    const customerId = await ctx.db.insert("customers", {
      businessId: source.businessId,
      phone: target,
      identityKey: `assistant-${target}`,
      name: options.isGroup ? "Launch group" : "Launch buyer",
      totalValue: 0,
      lastInteraction: now,
      lastInboundAt: now,
      isGroup: options.isGroup ?? false,
      tags: options.isGroup ? ["group"] : ["captured"],
    });
    return await ctx.db.insert("interactions", {
      businessId: source.businessId,
      customerId,
      sessionId: source.sessionId,
      role: "customer",
      content: options.content ?? "Is this available?",
      timestamp: now,
      receivedAt: now,
      messageType: "text",
      manualReviewRequired: false,
      isGroup: options.isGroup ?? false,
      wasMentioned: options.wasMentioned ?? false,
      ...(options.classifierLabel ? { classifierLabel: options.classifierLabel } : {}),
    });
  });
}

describe("Launch 1 assistant authorization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.AUTH_JWT_ISSUER = "https://auth.example.test";
    process.env.FOUNDATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("uses a bounded natural reply delay that grows with message length", () => {
    const short = assistantReplyDelayMs(20, "short-interaction");
    const long = assistantReplyDelayMs(500, "long-interaction");
    expect(short).toBeGreaterThanOrEqual(3_000);
    expect(long).toBeLessThanOrEqual(15_000);
    expect(long).toBeGreaterThan(short);
  });

  it("removes em and en dashes from assistant replies", () => {
    expect(normalizeAssistantReply("Yes o — e dey available – send your size."))
      .toBe("Yes o, e dey available, send your size.");
    expect(normalizeAssistantReply("Delivery takes 2–3 days."))
      .toBe("Delivery takes 2 to 3 days.");
  });

  it("uses the customer's speech pattern and stores a dash-free reply", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "speech-pattern");
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: directPrompt,
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
    });
    const interactionId = await inboundInteraction(harness, source, { content: "Abeg, una get this shoe for size 42?" });
    vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
    vi.stubEnv("GROQ_LLM_MODEL", "synthetic-model");
    let requestBody: { messages?: Array<{ role?: string; content?: string }> } | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input, init?: RequestInit) => {
      if (String(input) === "https://api.groq.com/openai/v1/chat/completions") {
        requestBody = JSON.parse(String(init?.body));
        return Response.json({ choices: [{ message: { content: "Yes o — e dey available. Abeg confirm the colour." } }] });
      }
      return new Response(null, { status: 404 });
    }));

    await harness.action(internal.assistantReply.prepareForInteraction, { interactionId });

    const systemMessage = requestBody?.messages?.find((message) => message.role === "system")?.content ?? "";
    expect(systemMessage).toContain("business system prompt has priority");
    expect(systemMessage).toContain("Within the style allowed by the business system prompt");
    expect(systemMessage).toContain("English, Nigerian Pidgin, or a natural mix");
    expect(systemMessage).toContain("Never use an em dash or en dash");
    expect(requestBody?.messages?.at(-1)?.content).toContain("Abeg, una get this shoe for size 42?");
    const [dispatch] = await harness.run((ctx) => ctx.db.query("assistantDispatches").collect());
    expect(dispatch.content).toBe("Yes o, e dey available. Abeg confirm the colour.");
    expect(dispatch.content).not.toMatch(/[—–]/);
  });

  it("keeps the business response pattern above customer style matching", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "business-style-priority");
    const formalPrompt = "You represent Business Style Priority, a Nigerian professional-services business. Always reply in formal English, address the customer politely, use complete sentences, and never use slang or Pidgin. Answer only with verified business facts, never invent prices, availability, timing, payment details, or policies, and ask one concise clarifying question when required information is missing.";
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: formalPrompt,
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
    });
    const interactionId = await inboundInteraction(harness, source, { content: "Abeg una fit help me sharp sharp?" });
    vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
    vi.stubEnv("GROQ_LLM_MODEL", "synthetic-model");
    let systemMessage = "";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input, init?: RequestInit) => {
      if (String(input) === "https://api.groq.com/openai/v1/chat/completions") {
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
        systemMessage = body.messages.find((message) => message.role === "system")?.content ?? "";
        return Response.json({ choices: [{ message: { content: "Certainly. Please tell us which service you require." } }] });
      }
      return new Response(null, { status: 404 });
    }));

    await harness.action(internal.assistantReply.prepareForInteraction, { interactionId });

    expect(systemMessage.startsWith(formalPrompt)).toBe(true);
    expect(systemMessage).toContain("business system prompt has priority for tone, language, wording, formatting, and response pattern");
    const [dispatch] = await harness.run((ctx) => ctx.db.query("assistantDispatches").collect());
    expect(dispatch.content).toBe("Certainly. Please tell us which service you require.");
  });

  it("requires a comprehensive system prompt before replies can be authorized", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "prompt-required");
    await expect(source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: "We sell shoes.",
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
    })).rejects.toThrow();

    const workspace = await source.owner.query(api.foundation.workspace, {});
    expect(workspace?.customerAutoReplyEnabled).toBe(false);
    expect(workspace?.hasBusinessSystemPrompt).toBe(false);
  });

  it("stores separate customer and group authorization", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "consent-scopes");
    const systemPrompt = "You represent Consent Scopes, a Lagos footwear business. Answer only from these facts, never invent prices or stock, ask one short question when details are missing, explain delivery accurately, escalate refunds and complaints to the owner, and use concise friendly WhatsApp replies without markdown.";
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt,
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
    });

    const profile = await source.owner.query(api.businessProfile.get, { businessId: source.businessId });
    expect(profile.systemPrompt).toBe(systemPrompt);
    expect(profile.customerAutoReplyEnabled).toBe(true);
    expect(profile.groupAutoReplyEnabled).toBe(false);
  });

  it("keeps each group disabled until it is individually enabled", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "group-opt-in");
    const systemPrompt = "You represent Group Opt In, a business selling clothing in Nigeria. Only answer using known business facts, never invent prices, payment details, delivery dates, or stock, ask for clarification when necessary, and escalate complaints, refunds, and uncertain requests to the owner in concise WhatsApp language.";
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt,
      customerAutoReplyEnabled: false,
      groupAutoReplyEnabled: true,
    });
    await harness.mutation(internal.groups.upsertFromProvider, {
      businessId: source.businessId,
      groups: [
        { jid: "120000000001@g.us", name: "Seller community", memberCount: 20, role: "admin" },
        { jid: "120000000002@g.us", name: "Industry news", memberCount: 200, role: "member" },
      ],
    });

    let groups = await source.owner.query(api.groups.list, { businessId: source.businessId });
    expect(groups.every((group) => !group.isEnabled)).toBe(true);
    await source.owner.mutation(api.groups.setEnabled, { businessId: source.businessId, groupJid: "120000000001@g.us", isEnabled: true });
    groups = await source.owner.query(api.groups.list, { businessId: source.businessId });
    expect(groups.find((group) => group.groupJid === "120000000001@g.us")?.isEnabled).toBe(true);
    expect(groups.find((group) => group.groupJid === "120000000002@g.us")?.isEnabled).toBe(false);
  });

  it("does not expose Status-to-Cash observations during Launch 1", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "status-blocked");
    await source.owner.mutation(api.extensions.updateSettings, { businessId: source.businessId, statusViewerListEnabled: true, automatedSendingRequested: false });
    const settings = await source.owner.query(api.extensions.settings, { businessId: source.businessId });
    expect(settings.statusViewerListEnabled).toBe(false);
    expect(await source.owner.query(api.extensions.statusViewers, { businessId: source.businessId })).toEqual([]);
  });

  it("does not reserve a reply without a prompt or the matching consent scope", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "reservation-gates");
    const interactionId = await inboundInteraction(harness, source);
    expect(await harness.mutation(internal.assistantReply.reserve, { interactionId, content: "Available." })).toBeNull();

    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: directPrompt,
      customerAutoReplyEnabled: false,
      groupAutoReplyEnabled: true,
    });
    expect(await harness.mutation(internal.assistantReply.reserve, { interactionId, content: "Available." })).toBeNull();
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toEqual([]);
  });

  it("requires an enabled group and honors mention-only before reserving", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "group-reservation-gates");
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: directPrompt,
      customerAutoReplyEnabled: false,
      groupAutoReplyEnabled: true,
    });
    await harness.mutation(internal.groups.upsertFromProvider, {
      businessId: source.businessId,
      groups: [{ jid: "120000000099@g.us", name: "Launch group", memberCount: 20, role: "admin" }],
    });
    const unmentioned = await inboundInteraction(harness, source, { isGroup: true, wasMentioned: false });
    expect(await harness.mutation(internal.assistantReply.reserve, { interactionId: unmentioned, content: "Hello group." })).toBeNull();

    await source.owner.mutation(api.groups.setEnabled, { businessId: source.businessId, groupJid: "120000000099@g.us", isEnabled: true });
    expect(await harness.mutation(internal.assistantReply.reserve, { interactionId: unmentioned, content: "Hello group." })).toBeNull();

    const mentioned = await inboundInteraction(harness, source, { isGroup: true, wasMentioned: true });
    expect(await harness.mutation(internal.assistantReply.reserve, { interactionId: mentioned, content: "Hello group." })).not.toBeNull();
  });

  it("enforces each simple group governance mode before AI generation", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "group-governance");
    const groupJid = "120000000088@g.us";
    await source.owner.mutation(api.businessProfile.save, { businessId: source.businessId, systemPrompt: directPrompt, customerAutoReplyEnabled: false, groupAutoReplyEnabled: true });
    await harness.mutation(internal.groups.upsertFromProvider, { businessId: source.businessId, groups: [{ jid: groupJid, name: "Governed group", memberCount: 25, role: "admin" }] });
    await source.owner.mutation(api.groups.setEnabled, { businessId: source.businessId, groupJid, isEnabled: true });

    const mentioned = await inboundInteraction(harness, source, { isGroup: true, wasMentioned: true, target: groupJid, classifierLabel: "buying_signal" });
    const question = await inboundInteraction(harness, source, { isGroup: true, target: groupJid, classifierLabel: "inquiry" });
    const unmentioned = await inboundInteraction(harness, source, { isGroup: true, target: groupJid, classifierLabel: "buying_signal" });

    await source.owner.mutation(api.groups.setGovernance, { businessId: source.businessId, groupJid, mode: "watch", allowPrivateHandoff: false });
    expect(await harness.query(internal.assistantReply.candidateForInteraction, { interactionId: mentioned })).toBeNull();
    await source.owner.mutation(api.groups.setGovernance, { businessId: source.businessId, groupJid, mode: "suggest", allowPrivateHandoff: false });
    expect(await harness.query(internal.assistantReply.candidateForInteraction, { interactionId: mentioned })).toBeNull();
    await source.owner.mutation(api.groups.setGovernance, { businessId: source.businessId, groupJid, mode: "mentions", allowPrivateHandoff: false });
    expect(await harness.query(internal.assistantReply.candidateForInteraction, { interactionId: mentioned })).not.toBeNull();
    expect(await harness.query(internal.assistantReply.candidateForInteraction, { interactionId: unmentioned })).toBeNull();
    await source.owner.mutation(api.groups.setGovernance, { businessId: source.businessId, groupJid, mode: "common_questions", allowPrivateHandoff: true });
    expect(await harness.query(internal.assistantReply.candidateForInteraction, { interactionId: question })).not.toBeNull();
    expect(await harness.query(internal.assistantReply.candidateForInteraction, { interactionId: unmentioned })).toBeNull();
    await source.owner.mutation(api.groups.setGovernance, { businessId: source.businessId, groupJid, mode: "custom", allowPrivateHandoff: false, customInstructions: "Only answer questions about delivery and opening hours." });
    const custom = await harness.query(internal.assistantReply.candidateForInteraction, { interactionId: unmentioned });
    expect(custom?.systemPrompt).toContain("Only answer questions about delivery and opening hours.");
  });

  it("creates at most one dispatch for a duplicate interaction", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "dispatch-deduplication");
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: directPrompt,
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
    });
    const interactionId = await inboundInteraction(harness, source);
    const first = await harness.mutation(internal.assistantReply.reserve, { interactionId, content: "Available." });
    const duplicate = await harness.mutation(internal.assistantReply.reserve, { interactionId, content: "A duplicate reply." });
    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toHaveLength(1);
  });

  it("cancels a reserved reply when consent is revoked before submission", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "consent-revocation");
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: directPrompt,
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
    });
    const interactionId = await inboundInteraction(harness, source);
    const dispatchId = await harness.mutation(internal.assistantReply.reserve, { interactionId, content: "Available." });
    expect(dispatchId).not.toBeNull();
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: directPrompt,
      customerAutoReplyEnabled: false,
      groupAutoReplyEnabled: false,
    });
    await harness.action(internal.assistantReply.submit, { dispatchId: dispatchId! });
    expect(await harness.run((ctx) => ctx.db.get(dispatchId!))).toMatchObject({ state: "cancelled", attempts: 1, errorCode: "AUTHORIZATION_REVOKED_BEFORE_SUBMIT" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks an ambiguous provider outcome unknown and never retries it", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "ambiguous-provider");
    await source.owner.mutation(api.businessProfile.save, {
      businessId: source.businessId,
      systemPrompt: directPrompt,
      customerAutoReplyEnabled: true,
      groupAutoReplyEnabled: false,
    });
    const interactionId = await inboundInteraction(harness, source);
    const dispatchId = await harness.mutation(internal.assistantReply.reserve, { interactionId, content: "Available." });
    expect(dispatchId).not.toBeNull();
    vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
    vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
    vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-provider-key");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input) => {
      if (String(input).endsWith("/message/presence")) return Response.json({ message: "success" });
      throw new Error("provider timeout after submission");
    }));

    await harness.action(internal.assistantReply.submit, { dispatchId: dispatchId! });
    expect(await harness.run((ctx) => ctx.db.get(dispatchId!))).toMatchObject({ state: "unknown", attempts: 1, errorCode: "provider timeout after submission" });
    expect(fetch).toHaveBeenCalledTimes(2);

    await harness.action(internal.assistantReply.submit, { dispatchId: dispatchId! });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await harness.run((ctx) => ctx.db.get(dispatchId!))).toMatchObject({ state: "unknown", attempts: 1 });
  });
});
