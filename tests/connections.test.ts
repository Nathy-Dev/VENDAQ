import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { decryptSecret } from "../convex/lib/crypto";
import { providerAccountAliases, providerConnectionState, providerContacts, providerDisplayName, providerGroups, providerIdentityMappings, providerInstances, providerQr, providerRequest } from "../convex/lib/evolution";
import { createHarness, drain, message, tenant, webhook } from "./harness";

function enableProvider() {
  vi.stubEnv("FOUNDATION_PROVIDER_ENABLED", "true");
  vi.stubEnv("FOUNDATION_PROVIDER_CONTRACT_VERIFIED", "true");
  vi.stubEnv("EVOLUTION_GO_URL", "https://provider.example.test");
  vi.stubEnv("EVOLUTION_GO_API_KEY", "synthetic-global-key");
  vi.stubEnv("CONVEX_SITE_URL", "https://convex.example.test");
}

describe("read-only provider sessions", () => {
  it("prioritizes saved contact names and resolves phone/LID account aliases", () => {
    expect(providerContacts({ data: [{ Jid: "2348000000001@s.whatsapp.net", FullName: "Saved Name", FirstName: "Saved", PushName: "Push Name", BusinessName: "Business Name" }] })).toEqual([{ jid: "2348000000001@s.whatsapp.net", name: "Saved Name" }]);
    const userInfo = { data: { Users: { "2348000000000@s.whatsapp.net": { LID: "987654321@lid" } } } };
    expect(providerAccountAliases(userInfo)).toEqual(["2348000000000@s.whatsapp.net", "987654321@lid"]);
    expect(providerIdentityMappings(userInfo)).toEqual([{ canonicalJid: "2348000000000@s.whatsapp.net", aliases: ["2348000000000@s.whatsapp.net", "987654321@lid"] }]);
  });

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
    const connectionResults = await Promise.all(Array.from({ length: 10 }, () => owner.action(api.connections.connect, { businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: true })));
    expect(calls.filter((call) => call.path === "/instance/create")).toHaveLength(1);
    expect(calls.filter((call) => call.path === "/instance/connect")).toHaveLength(1);
    const [session] = await harness.run((ctx) => ctx.db.query("whatsappSessions").collect());
    const plaintext = await decryptSecret(session.tokenCiphertext, `business:${businessId}:session-token`);
    const connectCall = calls.find((call) => call.path === "/instance/connect")!;
    const createCall = calls.find((call) => call.path === "/instance/create")!;
    expect(new Headers(connectCall.init?.headers).get("apikey")).toBe(plaintext);
    expect(JSON.parse(String(createCall.init?.body))).toEqual({ name: "New seller", token: plaintext });
    const body = JSON.parse(String(connectCall.init?.body));
    expect(body.subscribe).toEqual(["MESSAGE", "SEND_MESSAGE", "READ_RECEIPT", "CONNECTION", "QRCODE"]);
    expect(body.webhookUrl).toBe("https://convex.example.test/api/webhook/evolution");
    expect(connectionResults.some((result) => result.qr === "synthetic-qr-value")).toBe(true);
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

  it("does not confuse another business with the same provider display name", async () => {
    enableProvider();
    const harness = createHarness();
    const owner = harness.withIdentity({ subject: "google:same-name", issuer: "https://auth.example.test" });
    const businessId = await owner.mutation(api.foundation.createBusiness, { name: "Shared Store" });
    const calls: { path: string; init?: RequestInit }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push({ path, init });
      if (path === "/instance/all") return Response.json({ data: [{ id: "other-instance", name: "Shared Store", token: "other-token" }] });
      if (path === "/instance/create") return Response.json({ data: { id: "own-instance" } });
      if (path === "/instance/connect") return Response.json({ message: "success" });
      if (path === "/instance/status") return Response.json({ data: { Connected: false, LoggedIn: false } });
      if (path === "/instance/qr") return Response.json({ data: {} });
      throw new Error(`Unexpected provider operation: ${path}`);
    });

    await expect(owner.action(api.connections.connect, { businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: true })).resolves.toMatchObject({ state: "pending", error: null });
    const create = calls.find((call) => call.path === "/instance/create")!;
    expect(JSON.parse(String(create.init?.body)).name).toBe("Shared Store");
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

  it("resets a revoked session only after confirming its provider instance is absent", async () => {
    enableProvider();
    const harness = createHarness();
    const source = await tenant(harness);
    await harness.run((ctx) => ctx.db.patch(source.sessionId, { state: "revoked", lastError: "PROVIDER_DISCONNECT_DEAD_LETTER", disconnectAttempts: 5 }));
    const calls: { path: string; init?: RequestInit }[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push({ path, init });
      if (path === "/instance/all") return Response.json({ data: [] });
      if (path === "/instance/create") return Response.json({ data: { id: "replacement-instance" } });
      if (path === "/instance/connect") return Response.json({ message: "success" });
      if (path === "/instance/status") return Response.json({ data: { Connected: false, LoggedIn: false } });
      if (path === "/instance/qr") return Response.json({ data: {} });
      throw new Error(`Unexpected provider operation: ${path}`);
    });

    await expect(source.owner.action(api.connections.resetRevoked, { businessId: source.businessId })).resolves.toEqual({ state: "disconnected", qr: null, error: null });
    const reset = await harness.run((ctx) => ctx.db.get(source.sessionId));
    expect(reset?.state).toBe("disconnected");
    expect(reset?.generation).toBe(2);
    expect(reset?.providerInstanceId).toBeUndefined();
    expect(reset?.lastError).toBeUndefined();
    expect(reset?.tokenCiphertext).not.toBe(source.tokenCiphertext);
    expect(reset?.tokenHash).not.toBe(source.tokenHash);
    expect(new Headers(calls[0]?.init?.headers).get("apikey")).toBe("synthetic-global-key");

    await expect(source.owner.action(api.connections.connect, { businessId: source.businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: true })).resolves.toEqual({ state: "pending", qr: null, error: null });
    const credential = await decryptSecret(reset!.tokenCiphertext, `business:${source.businessId}:session-token`);
    const create = calls.find((call) => call.path === "/instance/create")!;
    const connect = calls.find((call) => call.path === "/instance/connect")!;
    expect(JSON.parse(String(create.init?.body)).token).toBe(credential);
    expect(new Headers(connect.init?.headers).get("apikey")).toBe(credential);
    expect(JSON.parse(String(create.init?.body)).name).toBe("seller-one");
  });

  it("keeps a new connection pending while QR generation is transient", async () => {
    enableProvider();
    const harness = createHarness();
    const owner = harness.withIdentity({ subject: "google:transient-qr", issuer: "https://auth.example.test" });
    const businessId = await owner.mutation(api.foundation.createBusiness, { name: "Transient QR seller" });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/instance/all") return Response.json({ data: [] });
      if (path === "/instance/create") return Response.json({ data: { id: "transient-instance" } });
      if (path === "/instance/connect") return Response.json({ message: "success" });
      if (path === "/instance/status") return Response.json({ data: { Connected: false, LoggedIn: false } });
      if (path === "/instance/qr") return Response.json({ message: "no QR code available" }, { status: 400 });
      throw new Error(`Unexpected provider operation: ${path}`);
    });

    await expect(owner.action(api.connections.connect, { businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk: true })).resolves.toEqual({ state: "pending", qr: null, error: null });
    expect((await owner.query(api.foundation.workspace, {}))?.state).toBe("pending");
  });

  it("repairs a stale encrypted provider token by the already-bound instance id", async () => {
    enableProvider();
    const harness = createHarness();
    const source = await tenant(harness);
    const currentToken = "provider-current-token";
    const calls: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      const credential = new Headers(init?.headers).get("apikey") ?? "";
      calls.push(`${path}:${credential}`);
      if (path === "/instance/status" && credential === source.token) return Response.json({ error: "not authorized" }, { status: 401 });
      if (path === "/instance/all") return Response.json({ data: [{ id: source.instanceId, name: "seller-one", token: currentToken, jid: "2348000000000:7@s.whatsapp.net" }] });
      if (path === "/instance/status" && credential === currentToken) return Response.json({ data: { Connected: true, LoggedIn: true } });
      throw new Error(`Unexpected provider operation: ${path}`);
    });

    await expect(harness.action(internal.connections.checkHealth, { sessionId: source.sessionId, generation: 1 })).resolves.toBeNull();
    const session = await harness.run((ctx) => ctx.db.get(source.sessionId));
    expect(session?.state).toBe("connected");
    expect(await decryptSecret(session!.tokenCiphertext, `business:${source.businessId}:session-token`)).toBe(currentToken);
    expect(calls).toEqual([
      `/instance/status:${source.token}`,
      "/instance/all:synthetic-global-key",
      `/instance/status:${currentToken}`,
    ]);
  });

  it("allows the internal operator path to apply the same guarded reset", async () => {
    enableProvider();
    const harness = createHarness();
    const source = await tenant(harness);
    await harness.run((ctx) => ctx.db.patch(source.sessionId, { state: "revoked", lastError: "PROVIDER_DISCONNECT_DEAD_LETTER" }));
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: [] }));

    await expect(harness.action(internal.connections.resetRevokedForOperator, { businessId: source.businessId })).resolves.toEqual({ state: "disconnected", qr: null, error: null });
    expect((await harness.run((ctx) => ctx.db.get(source.sessionId)))?.state).toBe("disconnected");
  });

  it("keeps a revoked session blocked when the remote instance still exists", async () => {
    enableProvider();
    const harness = createHarness();
    const source = await tenant(harness);
    await harness.run((ctx) => ctx.db.patch(source.sessionId, { state: "revoked", lastError: "PROVIDER_DISCONNECT_DEAD_LETTER" }));
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: [{ instance: { id: "different-id", name: `pipelixr-${source.businessId}` } }] }));

    await expect(source.owner.action(api.connections.resetRevoked, { businessId: source.businessId })).resolves.toEqual({ state: "revoked", qr: null, error: "PROVIDER_INSTANCE_STILL_EXISTS" });
    const unchanged = await harness.run((ctx) => ctx.db.get(source.sessionId));
    expect(unchanged?.state).toBe("revoked");
    expect(unchanged?.tokenCiphertext).toBe(source.tokenCiphertext);
    expect(unchanged?.providerInstanceId).toBe(source.instanceId);
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
    expect(providerQr({ data: { qrcode: { base64: "nested-base64" } } })).toBe("nested-base64");
    expect(providerQr({ data: { Code: "raw-qr-code" } })).toBe("raw-qr-code");
    expect(providerInstances({ data: [{ instance: { id: "nested-id", name: "nested-name", token: "nested-token", jid: "2348000000000:12@s.whatsapp.net" } }] })).toEqual([{ id: "nested-id", name: "nested-name", token: "nested-token", jid: "2348000000000:12@s.whatsapp.net" }]);
    expect(() => providerInstances({ message: "unexpected" })).toThrow("PROVIDER_INSTANCE_UNRESOLVED");
    expect(() => providerConnectionState({ unexpected: true })).toThrow("UNKNOWN_PROVIDER_STATE");
    expect(providerDisplayName("  Ada's   Studio  ", "business-id")).toBe("Ada's Studio");
    expect(providerDisplayName(" ", "business-id")).toBe("Pipelixr iness-id");
    enableProvider();
    vi.stubEnv("EVOLUTION_GO_URL", "http://public.example.test");
    await expect(providerRequest("GET", "/instance/all")).rejects.toThrow("INSECURE_PROVIDER_URL");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps Evolution Go group ownership and admin roles only for the connected account", () => {
    const groups = providerGroups({ data: [
      {
        JID: "120363000000001@g.us",
        OwnerJID: "2348000000000@s.whatsapp.net",
        GroupName: { Name: "Owner group" },
        Participants: [
          { JID: "2348000000000@s.whatsapp.net", IsAdmin: true, IsSuperAdmin: true },
          { JID: "2348111111111@s.whatsapp.net", IsAdmin: false, IsSuperAdmin: false },
        ],
      },
      {
        JID: "120363000000002@g.us",
        OwnerJID: "2348222222222@s.whatsapp.net",
        GroupName: { Name: "Admin group" },
        Participants: [
          { JID: "2348000000000@s.whatsapp.net", IsAdmin: true, IsSuperAdmin: false },
          { JID: "2348222222222@s.whatsapp.net", IsAdmin: true, IsSuperAdmin: true },
        ],
      },
      {
        JID: "120363000000003@g.us",
        OwnerJID: "2348333333333@s.whatsapp.net",
        GroupName: { Name: "Member group" },
        Participants: [
          { JID: "2348000000000@s.whatsapp.net", IsAdmin: false, IsSuperAdmin: false },
          { JID: "2348333333333@s.whatsapp.net", IsAdmin: true, IsSuperAdmin: true },
        ],
      },
      {
        JID: "120363000000004@g.us",
        OwnerJID: "123456789012345@lid",
        OwnerPN: "2348444444444@s.whatsapp.net",
        GroupName: { Name: "LID admin group" },
        Participants: [
          { JID: "987654321098765@lid", PhoneNumber: "2348000000000@s.whatsapp.net", IsAdmin: true, IsSuperAdmin: false },
          { JID: "123456789012345@lid", PhoneNumber: "2348444444444@s.whatsapp.net", IsAdmin: true, IsSuperAdmin: true },
        ],
      },
    ] }, "2348000000000:12@s.whatsapp.net");

    expect(groups).toEqual([
      { jid: "120363000000001@g.us", name: "Owner group", memberCount: 2, role: "owner" },
      { jid: "120363000000002@g.us", name: "Admin group", memberCount: 2, role: "admin" },
      { jid: "120363000000003@g.us", name: "Member group", memberCount: 2, role: "member" },
      { jid: "120363000000004@g.us", name: "LID admin group", memberCount: 2, role: "admin" },
    ]);
    expect(providerGroups({ data: [{ JID: "120363000000005@g.us", Participants: [{ JID: "2348999999999@s.whatsapp.net", IsAdmin: true }] }] })).toEqual([
      { jid: "120363000000005@g.us", name: "120363000000005", memberCount: 1, role: "member" },
    ]);
  });

  it("refreshes groups using the connected instance JID", async () => {
    enableProvider();
    const harness = createHarness();
    const source = await tenant(harness);
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/instance/all") return Response.json({ data: [{ id: source.instanceId, jid: "2348000000000:7@s.whatsapp.net" }] });
      if (path === "/user/info") return Response.json({ data: { Users: { "2348000000000@s.whatsapp.net": { LID: "987654321098765@lid" } } } });
      if (path === "/group/list") return Response.json({ data: [{
        JID: "120363000000005@g.us",
        OwnerJID: "2348999999999@s.whatsapp.net",
        GroupName: { Name: "Operations" },
        Participants: [
          { JID: "2348000000000@s.whatsapp.net", IsAdmin: true, IsSuperAdmin: false },
          { JID: "2348999999999@s.whatsapp.net", IsAdmin: true, IsSuperAdmin: true },
        ],
      }] });
      throw new Error(`Unexpected provider operation: ${path}`);
    });

    await expect(source.owner.action(api.groups.refresh, { businessId: source.businessId })).resolves.toEqual({ refreshed: 1 });
    await expect(source.owner.query(api.groups.list, { businessId: source.businessId })).resolves.toEqual([expect.objectContaining({ groupName: "Operations", role: "admin" })]);
  });

  it("refreshes groups with the provider's current token when the stored token is stale", async () => {
    enableProvider();
    const harness = createHarness();
    const source = await tenant(harness);
    const currentToken = "provider-current-token";
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/instance/all") return Response.json({ data: [{ id: source.instanceId, token: currentToken, jid: "2348000000000:7@s.whatsapp.net" }] });
      if (path === "/user/info") return Response.json({ data: { Users: { "2348000000000@s.whatsapp.net": { LID: "987654321098765@lid" } } } });
      if (path === "/group/list") {
        expect(new Headers(init?.headers).get("apikey")).toBe(currentToken);
        return Response.json({ data: [{
          JID: "120363000000006@g.us",
          GroupName: { Name: "Current token group" },
          Participants: [{ JID: "987654321098765@lid", PhoneNumber: "2348000000000@s.whatsapp.net", IsAdmin: true }],
        }] });
      }
      throw new Error(`Unexpected provider operation: ${path}`);
    });

    await expect(source.owner.action(api.groups.refresh, { businessId: source.businessId })).resolves.toEqual({ refreshed: 1 });
    const session = await harness.run((ctx) => ctx.db.get(source.sessionId));
    expect(await decryptSecret(session!.tokenCiphertext, `business:${source.businessId}:session-token`)).toBe(currentToken);
    await expect(source.owner.query(api.groups.list, { businessId: source.businessId })).resolves.toEqual([expect.objectContaining({ role: "admin" })]);
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
