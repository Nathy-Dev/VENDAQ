import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { decryptSecret } from "../convex/lib/crypto";
import { createHarness, drain, registeredGoogle, tenant, type Harness } from "./harness";

const secret = "synthetic-meta-signing-secret";
const token = "synthetic-meta-business-token";
const wabaId = "88220000001";
const phoneId = "88220000002";
const recipient = "2348000000001";
const inboxPath = "/api/webhook/meta/whatsapp";

beforeEach(() => {
  for (const [key, value] of Object.entries({ META_WHATSAPP_APP_ID: "88220000003", META_WHATSAPP_CONFIG_ID: "88220000004", META_GRAPH_VERSION: "v27.0", META_WHATSAPP_APP_SECRET: secret, META_WHATSAPP_VERIFY_TOKEN: "test-verification", META_WHATSAPP_ENABLED: "true", META_WHATSAPP_SEND_ENABLED: "true" })) vi.stubEnv(key, value);
});

function seconds(at = Date.now()) { return String(Math.floor(at / 1000)); }

function enableEvolution() {
  vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
  vi.stubEnv("FOUNDATION_PROVIDER_CONTRACT_VERIFIED", "true");
  vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
  vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-global-key");
  vi.stubEnv("CONVEX_SITE_URL", "https://convex.example.test");
}

function envelope<Value extends object>(field: string, value: Value, account = wabaId, phone = phoneId) {
  return { object: "whatsapp_business_account", entry: [{ id: account, time: Number(seconds()), changes: [{ field, value: { metadata: { phone_number_id: phone }, ...value } }] }] };
}

function post(harness: Harness, payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return harness.fetch(inboxPath, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature ?? `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` }, body });
}

function inbound(id = "wamid.inbound", timestamp = seconds(), body = "Is this available?") {
  return envelope("messages", { messages: [{ id, from: recipient, timestamp, type: "text", text: { body } }] });
}

async function seller(harness: Harness, label = "meta-owner") {
  const owner = await registeredGoogle(harness, label);
  const businessId = await owner.mutation(api.foundation.createBusiness, { name: label });
  return { owner, businessId };
}

function setupGraph(options: { coexistence?: boolean; bound?: boolean } = {}) {
  return vi.mocked(fetch).mockImplementation(async (input, init) => {
    const { pathname } = new URL(String(input));
    if (pathname.endsWith("/oauth/access_token")) return Response.json({ access_token: token });
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
    if (pathname.endsWith("/phone_numbers")) return Response.json({ data: options.bound !== false ? [{ id: phoneId }] : [] });
    if (pathname.endsWith(`/${phoneId}`)) return Response.json({ id: phoneId, is_on_biz_app: options.coexistence !== false, platform_type: "CLOUD_API", display_phone_number: "+234 802 000 0000" });
    if (pathname.endsWith("/subscribed_apps")) return Response.json({ success: true });
    if (pathname.endsWith("/smb_app_data")) return Response.json({ request_id: `request-${JSON.parse(String(init?.body)).sync_type}` });
    throw new Error("Unexpected Graph request");
  });
}

async function connect(harness: Harness, owner?: Awaited<ReturnType<typeof seller>>) {
  const source = owner ?? await seller(harness);
  setupGraph();
  const attempt = await source.owner.action(api.metaConnections.begin, { businessId: source.businessId, accepted: true });
  const result = await source.owner.action(api.metaConnections.complete, { businessId: source.businessId, attempt, code: "mock-exchange-code", wabaId, phoneId });
  expect(result).toEqual({ connected: true });
  await harness.finishInProgressScheduledFunctions();
  return source;
}

function awaitableSellerPlaceholder(): Awaited<ReturnType<typeof seller>> | undefined { return undefined; }

async function conversation(source: Awaited<ReturnType<typeof seller>>) {
  const contacts = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
  expect(contacts).toHaveLength(1);
  return { businessId: source.businessId, customerId: contacts[0].customerId };
}

describe("Meta WhatsApp Coexistence", () => {
  it("offers public Meta signup configuration independently from Evolution Go", async () => {
    const harness = createHarness();
    const source = await seller(harness);
    const args = { businessId: source.businessId };
    const meta = { appId: "88220000003", configId: "88220000004", version: "v27.0" };
    await expect(source.owner.query(api.connections.providers, args)).resolves.toEqual({ meta, evolution: false });
    enableEvolution();
    await expect(source.owner.query(api.connections.providers, args)).resolves.toEqual({ meta, evolution: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("holds the provider during Meta signup, then lets the owner pair with Evolution after cancelling", async () => {
    enableEvolution();
    const harness = createHarness();
    const source = await seller(harness);
    const args = { businessId: source.businessId };
    const evolutionArgs = { ...args, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: true };
    expect(await source.owner.query(api.foundation.workspace)).toMatchObject({ canChooseConnectionProvider: true });

    const attempt = await source.owner.action(api.metaConnections.begin, { ...args, accepted: true });
    const initial = await harness.query(internal.foundation.sessionByBusiness, args);
    expect(await source.owner.query(api.foundation.workspace)).toMatchObject({ canChooseConnectionProvider: false, connectionProvider: "meta" });
    await expect(source.owner.action(api.connections.connect, evolutionArgs)).rejects.toThrow("META_CONNECTION_EXISTS");
    expect(fetch).not.toHaveBeenCalled();

    await source.owner.mutation(api.metaConnections.cancel, { ...args, attempt });
    expect(await source.owner.query(api.foundation.workspace)).toMatchObject({ canChooseConnectionProvider: true });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const { pathname } = new URL(String(input));
      if (pathname === "/instance/all") return Response.json({ data: [] });
      if (pathname === "/instance/create") return Response.json({ data: { id: "switch-evolution" } });
      if (pathname === "/instance/connect") return Response.json({ message: "success" });
      if (pathname === "/instance/status") return Response.json({ data: { Connected: false, LoggedIn: false } });
      if (pathname === "/instance/qr") return Response.json({ data: { Qrcode: "synthetic-pairing-qr" } });
      throw new Error("Unexpected Evolution Go request");
    });
    await expect(source.owner.action(api.connections.connect, evolutionArgs)).resolves.toMatchObject({ state: "pending", error: null });
    expect(await harness.query(internal.foundation.sessionByBusiness, args)).toMatchObject({ _id: initial?._id, generation: (initial?.generation ?? 0) + 1, providerInstanceId: "switch-evolution" });
    await expect(source.owner.action(api.metaConnections.begin, { ...args, accepted: true })).rejects.toThrow("META_EXISTING_CONNECTION");
    await drain(harness);
    expect(await source.owner.query(api.foundation.workspace)).toMatchObject({ state: "pending", canChooseConnectionProvider: false, connectionProvider: "evolution" });
  });

  it("does not switch away from a Meta account that remains linked", async () => {
    enableEvolution();
    const harness = createHarness();
    const source = await connect(harness);
    const args = { businessId: source.businessId };
    await source.owner.mutation(api.metaConnections.disconnect, args);
    expect(await source.owner.query(api.foundation.workspace)).toMatchObject({ state: "disconnected", canChooseConnectionProvider: false, connectionProvider: "meta" });
    await expect(source.owner.action(api.connections.connect, { ...args, acceptedRisk: true, disclosureVersion: "phase-1-2026-10-27" })).rejects.toThrow("META_CONNECTION_EXISTS");

    expect((await post(harness, envelope("account_update", { event: "PARTNER_REMOVED", waba_info: { waba_id: wabaId } }))).status).toBe(200);
    expect(await source.owner.query(api.foundation.workspace)).toMatchObject({ state: "disconnected", canChooseConnectionProvider: true });
    await drain(harness);
  });

  it("only lets a previously paired Evolution workspace choose Meta after a verified reset", async () => {
    enableEvolution();
    const harness = createHarness();
    const source = await tenant(harness, "switch-from-evolution");
    const args = { businessId: source.businessId };
    const startMeta = () => source.owner.action(api.metaConnections.begin, { ...args, accepted: true });
    await harness.run((ctx) => ctx.db.patch(source.sessionId, { state: "disconnected" }));
    expect(await source.owner.query(api.foundation.workspace)).toMatchObject({ canChooseConnectionProvider: false });
    await expect(startMeta()).rejects.toThrow("META_EXISTING_CONNECTION");

    await source.owner.mutation(api.foundation.revokeSession, args);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: [{ id: source.instanceId }] }));
    await expect(source.owner.action(api.connections.resetRevoked, args)).resolves.toMatchObject({ error: "PROVIDER_INSTANCE_STILL_EXISTS" });
    await expect(startMeta()).rejects.toThrow("META_EXISTING_CONNECTION");

    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: [] }));
    await expect(source.owner.action(api.connections.resetRevoked, args)).resolves.toMatchObject({ state: "disconnected", error: null });
    expect(await source.owner.query(api.foundation.workspace)).toMatchObject({ canChooseConnectionProvider: true });
    await expect(startMeta()).resolves.toEqual(expect.any(String));
    expect(await harness.query(internal.foundation.sessionByBusiness, args)).toMatchObject({ _id: source.sessionId, generation: 3, provider: "meta", state: "provisioning" });
    await drain(harness);
  });

  it("requires owner consent, exchanges only once, encrypts the token and starts the two sync requests", async () => {
    const harness = createHarness();
    const source = await seller(harness);
    const outsider = await seller(harness, "other-seller");
    await expect(outsider.owner.action(api.metaConnections.begin, { businessId: source.businessId, accepted: true })).rejects.toThrow("NOT_FOUND");
    await expect(source.owner.action(api.metaConnections.begin, { businessId: source.businessId, accepted: false })).rejects.toThrow("META_SIGNUP_UNAVAILABLE");
    const graph = setupGraph();
    const attempt = await source.owner.action(api.metaConnections.begin, { businessId: source.businessId, accepted: true });
    const args = { businessId: source.businessId, attempt, code: "mock-exchange-code", wabaId, phoneId };
    await expect(outsider.owner.action(api.metaConnections.complete, args)).rejects.toThrow("NOT_FOUND");
    expect(await source.owner.action(api.metaConnections.complete, args)).toEqual({ connected: true });
    await expect(source.owner.action(api.metaConnections.complete, args)).rejects.toThrow("META_SIGNUP_EXPIRED");
    await drain(harness);
    const session = await harness.query(internal.foundation.sessionByBusiness, { businessId: source.businessId });
    expect(session).toMatchObject({ provider: "meta", state: "connected", meta: { contactsState: "requested", historyState: "requested" } });
    expect(session?.tokenCiphertext).not.toContain(token);
    expect(await decryptSecret(session!.tokenCiphertext, `business:${source.businessId}:session-token`)).toBe(token);
    expect(graph.mock.calls.filter(([input]) => String(input).includes("oauth/access_token"))).toHaveLength(1);
    expect(graph.mock.calls.some(([input]) => String(input).includes("/register"))).toBe(false);
    expect(JSON.stringify(await source.owner.query(api.foundation.workspace))).not.toContain(token);
  });

  it("rejects a number outside the account, a non-Coexistence number, and an existing tenant binding", async () => {
    const harness = createHarness();
    const source = await seller(harness);
    const attemptSetup = async () => {
      const attempt = await source.owner.action(api.metaConnections.begin, { businessId: source.businessId, accepted: true });
      return source.owner.action(api.metaConnections.complete, { businessId: source.businessId, attempt, code: "mock-exchange-code", wabaId, phoneId });
    };
    setupGraph({ bound: false });
    expect(await attemptSetup()).toMatchObject({ connected: false, error: "META_NUMBER_NOT_IN_ACCOUNT" });
    setupGraph({ coexistence: false });
    expect(await attemptSetup()).toMatchObject({ connected: false, error: "META_COEXISTENCE_REQUIRED" });
    await connect(harness, await seller(harness, "first-owner"));
    expect(await attemptSetup()).toMatchObject({ connected: false, error: "META_ASSET_ALREADY_BOUND" });
    const evolution = await tenant(harness, "evolution-owner");
    await expect(evolution.owner.action(api.metaConnections.begin, { businessId: evolution.businessId, accepted: true })).rejects.toThrow("META_EXISTING_CONNECTION");
    await drain(harness);
  });

  it("verifies the challenge and raw-body signature and routes only the correct account and phone", async () => {
    const harness = createHarness();
    const source = await connect(harness);
    const ok = await harness.fetch(`${inboxPath}?hub.mode=subscribe&hub.verify_token=test-verification&hub.challenge=123456`);
    expect(await ok.text()).toBe("123456");
    expect((await harness.fetch(`${inboxPath}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123456`)).status).toBe(403);
    expect((await post(harness, inbound(), `sha256=${"a".repeat(64)}`)).status).toBe(401);
    expect((await post(harness, envelope("messages", { messages: inbound().entry[0].changes[0].value.messages }, "99990000001"))).status).toBe(200);
    expect((await post(harness, { ...inbound(), entry: [{ ...inbound().entry[0], changes: [{ field: "messages", value: { ...inbound().entry[0].changes[0].value, metadata: { phone_number_id: "99990000002" } } }] }] })).status).toBe(200);
    expect(await source.owner.query(api.foundation.customers, { businessId: source.businessId })).toEqual([]);
    expect((await post(harness, inbound())).status).toBe(200);
    expect((await post(harness, inbound())).status).toBe(200);
    expect((await post(harness, envelope("smb_message_echoes", { message_echoes: [{ id: "wamid.app-reply", from: "2348020000000", to: recipient, timestamp: seconds(), type: "text", text: { body: "Available from the app" } }] }))).status).toBe(200);
    await drain(harness);
    expect((await source.owner.query(api.foundation.messages, await conversation(source))).map((message) => message.role).sort()).toEqual(["customer", "owner"]);
  });

  it("imports consented history as display-only data and handles late live delivery without a duplicate", async () => {
    const harness = createHarness();
    const source = await connect(harness);
    await source.owner.mutation(api.businessProfile.setAssistantEnabled, { businessId: source.businessId, enabled: true });
    await post(harness, envelope("smb_app_state_sync", { state_sync: [{ type: "contact", action: "add", metadata: { timestamp: seconds() }, contact: { phone_number: recipient, full_name: "Contact Name" } }] }));
    await post(harness, envelope("history", { history: [{ metadata: { progress: 100 }, threads: [{ id: recipient, messages: inbound("wamid.history").entry[0].changes[0].value.messages }] }] }));
    await drain(harness);
    const args = await conversation(source);
    expect(await source.owner.query(api.assistantReply.sellerReplyInfo, args)).toEqual({ expiresAt: null, latest: null });
    expect(await harness.run((ctx) => ctx.db.query("communicationConsents").collect())).toEqual([]);
    expect(await harness.run((ctx) => ctx.db.query("interactions").first())).toMatchObject({ metaHistorical: true, aiProcessingEpoch: null });
    expect((await source.owner.query(api.foundation.workspace))?.meta).toMatchObject({ contactsState: "received", historyState: "complete" });
    await post(harness, inbound("wamid.history"));
    await drain(harness);
    expect(await source.owner.query(api.foundation.messages, args)).toHaveLength(1);
    expect((await source.owner.query(api.assistantReply.sellerReplyInfo, args)).expiresAt).toBeGreaterThan(Date.now());
  });

  it("enforces tenant and window checks, submits once, and reconciles ambiguous delivery with signed receipts", async () => {
    const harness = createHarness();
    const source = await connect(harness);
    const outsider = await seller(harness, "reply-outsider");
    await post(harness, inbound());
    await drain(harness);
    const args = await conversation(source);
    const request = { ...args, requestId: "0e0b5d49-d020-489d-8723-6f2504cf13af", content: "It is available" };
    await expect(outsider.owner.mutation(api.assistantReply.queueSellerReply, request)).rejects.toThrow("NOT_FOUND");
    const send = vi.mocked(fetch).mockReset().mockImplementation(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe(`/v27.0/${phoneId}/messages`);
      expect(JSON.parse(String(init?.body))).toMatchObject({ to: recipient, type: "text", text: { body: request.content } });
      throw new Error("ambiguous response");
    });
    const dispatchId = await source.owner.mutation(api.assistantReply.queueSellerReply, request);
    expect(await source.owner.mutation(api.assistantReply.queueSellerReply, request)).toBe(dispatchId);
    await drain(harness);
    expect(await source.owner.query(api.assistantReply.sellerReplyInfo, args)).toMatchObject({ latest: "unknown" });
    await harness.action(internal.assistantReply.submit, { dispatchId });
    expect(send).toHaveBeenCalledTimes(1);
    const receipt = (status: string) => envelope("messages", { statuses: [{ id: "wamid.outbound", status, timestamp: seconds(), biz_opaque_callback_data: dispatchId }] });
    await post(harness, receipt("read"));
    await post(harness, receipt("sent"));
    await drain(harness);
    expect(await source.owner.query(api.assistantReply.sellerReplyInfo, args)).toMatchObject({ latest: "read" });
    expect((await source.owner.query(api.foundation.messages, args)).filter((message) => message.role === "owner")).toEqual([expect.objectContaining({ text: request.content, assistantGenerated: false })]);
    vi.setSystemTime(Date.now() + 86_400_000);
    await expect(source.owner.mutation(api.assistantReply.queueSellerReply, { ...request, requestId: "190fb67f-5119-4b62-a96b-5c12d62e63d1" })).rejects.toThrow("META_SERVICE_REPLY_UNAVAILABLE");
  });

  it("handles offboarding in the account-update envelope and drops queued events from the old generation", async () => {
    const harness = createHarness();
    const source = await connect(harness);
    await post(harness, inbound());
    expect((await post(harness, envelope("account_update", { event: "PARTNER_REMOVED", waba_info: { waba_id: wabaId } }, "12345000009"))).status).toBe(200);
    await drain(harness);
    const session = await harness.query(internal.foundation.sessionByBusiness, { businessId: source.businessId });
    expect(session).toMatchObject({ state: "disconnected", tokenCiphertext: "", lastError: "META_OFFBOARDED" });
    expect(session?.providerInstanceId).toBeUndefined();
    expect(await source.owner.query(api.foundation.customers, { businessId: source.businessId })).toEqual([]);
  });

  it("reports declined history and stops a queued send when Meta revokes the business token", async () => {
    const harness = createHarness();
    const source = await connect(harness);
    await post(harness, envelope("history", { history: [{ errors: [{ code: 2593109 }] }] }));
    await post(harness, inbound());
    await drain(harness);
    expect((await source.owner.query(api.foundation.workspace))?.meta?.historyState).toBe("declined");
    const args = await conversation(source);
    vi.mocked(fetch).mockReset().mockImplementation(async () => Response.json({ error: { code: 190 } }, { status: 401 }));
    const dispatchId = await source.owner.mutation(api.assistantReply.queueSellerReply, { ...args, requestId: "6009f72d-8cd8-41e3-9b0f-f221c91ca14c", content: "Available" });
    await drain(harness);
    expect(await harness.run((ctx) => ctx.db.get(dispatchId))).toMatchObject({ state: "failed", errorCode: "META_AUTH_EXPIRED" });
    expect(await source.owner.query(api.foundation.workspace)).toMatchObject({ state: "disconnected", lastError: "META_AUTH_EXPIRED" });
    expect(await source.owner.query(api.assistantReply.sellerReplyInfo, args)).toMatchObject({ expiresAt: null, latest: "failed" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("expires abandoned signup attempts and rejects their old exchange codes", async () => {
    const harness = createHarness();
    const source = await seller(harness);
    const attempt = await source.owner.action(api.metaConnections.begin, { businessId: source.businessId, accepted: true });
    await drain(harness);
    expect(await source.owner.query(api.foundation.workspace)).toMatchObject({ state: "error", lastError: "META_SIGNUP_EXPIRED", canChooseConnectionProvider: true });
    await expect(source.owner.action(api.metaConnections.complete, { businessId: source.businessId, attempt, code: "mock-exchange-code", wabaId, phoneId })).rejects.toThrow("META_SIGNUP_EXPIRED");
    expect(fetch).not.toHaveBeenCalled();
  });
});
