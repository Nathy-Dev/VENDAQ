import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { decryptSecret } from "../convex/lib/crypto";
import { providerConnectionState, providerQr, providerRequest } from "../convex/lib/evolution";
import { createHarness, drain, message, tenant, webhook } from "./harness";

function enableProvider() {
  vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
  vi.stubEnv("FOUNDATION_PROVIDER_CONTRACT_VERIFIED", "true");
  vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
  vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-global-key");
  vi.stubEnv("CONVEX_SITE_URL", "https://convex.example.test");
}

describe("read-only provider sessions", () => {
  it("requires ownership, disclosure, and explicit contract qualification", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await expect(source.owner.action(api.connections.connect, { businessId: source.businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: false })).rejects.toThrow("DISCLOSURE_REQUIRED");
    const response = await source.owner.action(api.connections.connect, { businessId: source.businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: true });
    expect(response.error).toBe("PROVIDER_QUALIFICATION_REQUIRED");
    await expect(harness.action(api.connections.refresh, { businessId: source.businessId })).rejects.toThrow("UNAUTHENTICATED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a safe error when connection encryption is misconfigured", async () => {
    enableProvider();
    vi.stubEnv("SESSION_ENCRYPTION_KEYS", "{v1:invalid}");
    vi.stubEnv("SESSION_ENCRYPTION_KEY_VERSION", "v1");
    const harness = createHarness();
    const owner = harness.withIdentity({ subject: "google:config-error", issuer: "https://auth.example.test" });
    const businessId = await owner.mutation(api.foundation.createBusiness, { name: "Config error seller" });

    await expect(owner.action(api.connections.connect, { businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: true })).resolves.toEqual({ state: "disconnected", qr: null, error: "CONNECTION_SECURITY_UNAVAILABLE" });
    expect(await harness.run((ctx) => ctx.db.query("whatsappSessions").collect())).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serializes concurrent connects, encrypts credentials, and uses the documented Go QR shape", async () => {
    enableProvider();
    const harness = createHarness();
    const owner = harness.withIdentity({ subject: "google:new", issuer: "https://auth.example.test" });
    const businessId = await owner.mutation(api.foundation.createBusiness, { name: "New seller" });
    const calls: { path: string; init?: RequestInit }[] = [];
    let connected = false;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push({ path, init });
      if (path === "/instance/all") return Response.json({ data: [] });
      if (path === "/instance/create") return Response.json({ data: { id: "new-instance" } });
      if (path === "/instance/connect") return Response.json({ message: "success" });
      if (path === "/instance/status") return Response.json({ data: { Connected: true, LoggedIn: connected } });
      if (path === "/instance/qr") return Response.json({ data: { Qrcode: "synthetic-qr-value" } });
      throw new Error(`Unexpected provider operation: ${path}`);
    });
    await Promise.all(Array.from({ length: 10 }, () => owner.action(api.connections.connect, { businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: true })));
    expect(calls.filter((call) => call.path === "/instance/create")).toHaveLength(1);
    expect(calls.filter((call) => call.path === "/instance/connect")).toHaveLength(1);
    const [session] = await harness.run((ctx) => ctx.db.query("whatsappSessions").collect());
    const plaintext = await decryptSecret(session.tokenCiphertext, `business:${businessId}:session-token`);
    const connectCall = calls.find((call) => call.path === "/instance/connect")!;
    expect(new Headers(connectCall.init?.headers).get("apikey")).toBe(plaintext);
    const body = JSON.parse(String(connectCall.init?.body));
    expect(body.subscribe).toEqual(["MESSAGE", "SEND_MESSAGE", "READ_RECEIPT", "CONNECTION", "QRCODE"]);
    expect(body.webhookUrl).toBe("https://convex.example.test/api/webhook/evolution");
    const refreshed = await owner.action(api.connections.refresh, { businessId });
    expect(refreshed.qr).toBe("synthetic-qr-value");
    const pending = await harness.run((ctx) => ctx.db.get(session._id));
    expect(pending?.qrCiphertext).not.toContain("synthetic-qr-value");
    connected = true;
    expect((await owner.action(api.connections.refresh, { businessId })).state).toBe("connected");
    expect((await harness.run((ctx) => ctx.db.get(session._id)))?.qrCiphertext).toBeUndefined();
    await owner.action(api.connections.connect, { businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: true });
    expect(calls.filter((call) => call.path === "/instance/connect")).toHaveLength(1);
  });

  it("does not blindly recreate an instance after an unknown create outcome", async () => {
    enableProvider();
    const harness = createHarness();
    const owner = harness.withIdentity({ subject: "google:new", issuer: "https://auth.example.test" });
    const businessId = await owner.mutation(api.foundation.createBusiness, { name: "New seller" });
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/instance/all")) return Response.json({ data: [] });
      throw new Error("synthetic timeout with private provider content");
    });
    const args = { businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: true };
    expect((await owner.action(api.connections.connect, args)).state).toBe("error");
    expect((await owner.action(api.connections.connect, args)).error).toBe("PROVIDER_INSTANCE_UNRESOLVED");
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith("/instance/create"))).toHaveLength(1);
    expect(JSON.stringify(await owner.query(api.foundation.workspace, {}))).not.toContain("private provider");
  });

  it("revokes capture immediately, rejects old jobs, and exhausts disconnect retries visibly", async () => {
    enableProvider();
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source));
    await source.owner.mutation(api.foundation.revokeSession, { businessId: source.businessId });
    expect((await webhook(harness, message(source, { id: "late" }))).status).toBe(401);
    await drain(harness);
    const session = await harness.run((ctx) => ctx.db.get(source.sessionId));
    expect(session?.state).toBe("revoked");
    expect(session?.disconnectAttempts).toBe(5);
    expect(session?.lastError).toBe("PROVIDER_DISCONNECT_DEAD_LETTER");
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(await harness.run((ctx) => ctx.db.query("interactions").collect())).toHaveLength(0);
    await expect(source.owner.action(api.connections.connect, { businessId: source.businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: true })).rejects.toThrow("SESSION_REVOKED_REQUIRES_OPERATOR_RESET");
  });

  it("clears revoked credentials only after provider disconnect succeeds", async () => {
    enableProvider();
    const harness = createHarness();
    const source = await tenant(harness);
    vi.mocked(fetch).mockResolvedValue(Response.json({ message: "success" }));
    await source.owner.mutation(api.foundation.revokeSession, { businessId: source.businessId });
    await drain(harness);
    const session = await harness.run((ctx) => ctx.db.get(source.sessionId));
    expect(session?.tokenCiphertext).toBe("");
    expect(session?.tokenHash).toBe("");
    expect(session?.disconnectedAt).toBeDefined();
    const disconnectCalls = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith("/instance/disconnect"));
    expect(disconnectCalls).toHaveLength(1);
  });

  it("fences stale session operations and refuses duplicate provider bindings", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const other = await tenant(harness, "other");
    await harness.run((ctx) => ctx.db.patch(source.sessionId, { operationVersion: 2 }));
    await harness.mutation(internal.foundation.updateSession, { sessionId: source.sessionId, generation: 1, operationVersion: 1, state: "error" });
    expect((await harness.run((ctx) => ctx.db.get(source.sessionId)))?.state).toBe("connected");
    await expect(harness.mutation(internal.foundation.updateSession, { sessionId: source.sessionId, generation: 1, state: "pending", providerInstanceId: other.instanceId })).rejects.toThrow("INSTANCE_ALREADY_BOUND");
  });

  it("interprets Connected versus LoggedIn correctly and rejects insecure provider URLs", async () => {
    expect(providerConnectionState({ data: { Connected: true, LoggedIn: false } })).toBe("pending");
    expect(providerConnectionState({ data: { Connected: false, LoggedIn: true } })).toBe("disconnected");
    expect(providerQr({ data: { Qrcode: "synthetic-qr" } })).toBe("synthetic-qr");
    expect(() => providerConnectionState({ unexpected: true })).toThrow("UNKNOWN_PROVIDER_STATE");
    enableProvider();
    vi.stubEnv("EVOLUTION_GO_URL", "http://public.example.test");
    await expect(providerRequest("GET", "/instance/all")).rejects.toThrow("INSECURE_PROVIDER_URL");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bypasses the ngrok browser warning and rejects non-JSON provider pages", async () => {
    enableProvider();
    vi.stubEnv("EVOLUTION_GO_URL", "https://provider.ngrok-free.dev");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: [] }));
    await expect(providerRequest("GET", "/instance/all")).resolves.toEqual({ data: [] });
    const headers = new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("ngrok-skip-browser-warning")).toBe("pipelixr");

    vi.mocked(fetch).mockResolvedValueOnce(new Response("ngrok warning", { status: 200, headers: { "content-type": "text/plain" } }));
    await expect(providerRequest("GET", "/instance/all")).rejects.toThrow("PROVIDER_REQUEST_FAILED");
  });
});
