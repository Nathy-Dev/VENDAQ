import { Auth } from "@auth/core";
import { generateKeyPairSync } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import NextAuth, { type NextAuthConfig } from "next-auth";
import { encode } from "next-auth/jwt";
import { describe, expect, it, vi } from "vitest";
import "../auth";
import { api } from "../convex/_generated/api";
import { GET as getConvexToken } from "../src/app/api/auth/convex-token/route";
import { publicJwks } from "../src/lib/convex-auth";
import { createHarness } from "./harness";

const { readAuthSession } = vi.hoisted(() => ({ readAuthSession: vi.fn() }));
vi.mock("next-auth", () => ({ default: vi.fn(() => ({ auth: readAuthSession })) }));

const authConfig = vi.mocked(NextAuth).mock.calls[0][0] as NextAuthConfig;
const { callbacks } = authConfig;
const googleIdentity = {
  subject: "google:seller-one",
  issuer: "https://auth.example.test",
  email: "Seller@Example.test",
  email_verified: true,
  name: "Google seller",
  picture: "https://images.example.test/seller",
};
const googleSignIn = {
  token: {},
  user: { id: "auth-js-user", name: googleIdentity.name, image: googleIdentity.picture },
  account: { provider: "google", providerAccountId: "seller-one", type: "oidc" as const },
  profile: { email: googleIdentity.email, email_verified: true },
  trigger: "signIn" as const,
};

function configureSigningKey() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vi.stubEnv("AUTH_JWT_PRIVATE_KEY", Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"));
  vi.stubEnv("AUTH_JWT_KEY_ID", "synthetic-key");
}

describe("Google sign-in provisioning", () => {
  it("sends verified profile claims to Convex and keeps the existing session subject", async () => {
    configureSigningKey();
    const userId = "synthetic-google-user";
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "success", value: userId }));

    await expect(callbacks!.jwt!({ ...googleSignIn, token: {} })).resolves.toMatchObject({ id: googleIdentity.subject, convexUserId: userId });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toMatch(/\/api\/mutation$/);
    expect(JSON.parse(request?.body as string)).toMatchObject({ path: "users:upsertGoogleUser" });
    const authorization = new Headers(request?.headers).get("authorization");
    expect(authorization).toMatch(/^Bearer /);
    const { payload } = await jwtVerify(authorization!.slice("Bearer ".length), createLocalJWKSet(await publicJwks()), {
      issuer: googleIdentity.issuer,
      audience: "pipelixr",
    });
    expect(payload).toMatchObject({
      sub: googleIdentity.subject,
      email: googleIdentity.email,
      email_verified: true,
      name: googleIdentity.name,
      picture: googleIdentity.picture,
    });
    await expect(callbacks!.jwt!({ ...googleSignIn, token: {} })).rejects.toThrow("NETWORK_DISABLED_IN_TEST");
  });

  it("rejects unverified Google callbacks before contacting Convex", async () => {
    await expect(callbacks!.jwt!({
      ...googleSignIn,
      profile: { ...googleSignIn.profile, email_verified: false },
    })).rejects.toThrow("UNVERIFIED_GOOGLE_IDENTITY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("provisions from raw custom-JWT claims and updates the same Google user when the email changes", async () => {
    const harness = createHarness();
    const google = harness.withIdentity(googleIdentity);
    await Promise.all([google.mutation(api.users.upsertGoogleUser, {}), google.mutation(api.users.upsertGoogleUser, {})]);
    const [original] = await harness.run((ctx) => ctx.db.query("users").take(2));
    expect(original).toMatchObject({
      googleSubject: googleIdentity.subject,
      email: "seller@example.test",
      emailVerified: Date.now(),
      name: googleIdentity.name,
      image: googleIdentity.picture,
    });
    expect(original).not.toHaveProperty("password");

    vi.setSystemTime(Date.now() + 1000);
    await harness.withIdentity({ ...googleIdentity, email: "new@example.test" }).mutation(api.users.upsertGoogleUser, {});
    expect(await harness.run((ctx) => ctx.db.query("users").take(2))).toEqual([{
      ...original, email: "new@example.test", emailVerified: Date.now(),
    }]);
  });

  it("requires the trusted issuer, a Google subject, and a verified email", async () => {
    const harness = createHarness();
    await expect(harness.mutation(api.users.upsertGoogleUser, {})).rejects.toThrow("UNAUTHENTICATED");
    const untrusted = harness.withIdentity({ ...googleIdentity, issuer: "https://other.example.test" });
    await expect(untrusted.mutation(api.users.upsertGoogleUser, {})).rejects.toThrow("UNAUTHENTICATED");
    const credentials = harness.withIdentity({ ...googleIdentity, subject: "credentials:seller-one" });
    await expect(credentials.mutation(api.users.upsertGoogleUser, {})).rejects.toThrow("UNVERIFIED_GOOGLE_IDENTITY");
    for (const email_verified of [false, "true", undefined]) {
      const unverified = harness.withIdentity({ ...googleIdentity, email_verified });
      await expect(unverified.mutation(api.users.upsertGoogleUser, {})).rejects.toThrow("UNVERIFIED_GOOGLE_IDENTITY");
    }
    expect(await harness.run((ctx) => ctx.db.query("users").take(1))).toEqual([]);
  });

  it("keeps Google and credential accounts with the same email separate", async () => {
    const harness = createHarness();
    await harness.withIdentity(googleIdentity).mutation(api.users.upsertGoogleUser, {});
    vi.useRealTimers();
    const login = { email: googleIdentity.email, password: "long-synthetic-password" };
    const credentialsId = await harness.action(api.auth.createUser, { ...login, name: "Password seller" });
    expect(await harness.action(api.auth.verifyUser, login)).toMatchObject({ id: credentialsId, name: "Password seller" });
    const users = await harness.run((ctx) => ctx.db.query("users").withIndex("by_email", (index) => index.eq("email", "seller@example.test")).take(3));
    expect(users).toHaveLength(2);
    expect(users.find((user) => user.googleSubject === googleIdentity.subject)).not.toHaveProperty("password");
  });
});

describe("account-bound sessions", () => {
  it("keeps active browser sessions and clears deleted or unbound sessions", async () => {
    configureSigningKey();
    const secret = "synthetic-session-secret-only-for-tests";
    const salt = "__Secure-authjs.session-token";
    const userId = "synthetic-google-user";
    const readSession = async (token: { id: string; convexUserId?: string }) => {
      const cookie = await encode({ secret, salt, token });
      const request = new Request("https://example.test/api/auth/session", { headers: { cookie: `${salt}=${cookie}` } });
      return await Auth(request, { ...authConfig, basePath: "/api/auth", secret, trustHost: true });
    };
    const convexTokenRequest = new Request("https://example.test/api/auth/convex-token");

    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "success", value: true }));
    const active = await readSession({ id: googleIdentity.subject, convexUserId: userId });
    const activeSession = await active.json();
    expect(activeSession).toMatchObject({ user: { id: googleIdentity.subject }, convexUserId: userId });
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toMatch(/\/api\/query$/);
    expect(JSON.parse(request?.body as string)).toMatchObject({ path: "users:sessionActive", args: [{}] });
    expect(request?.cache).toBe("no-store");
    const authorization = new Headers(request?.headers).get("authorization");
    const { payload } = await jwtVerify(authorization!.slice("Bearer ".length), createLocalJWKSet(await publicJwks()));
    expect(payload).toMatchObject({ sub: googleIdentity.subject, pipelixr_user_id: userId });
    expect(payload).not.toHaveProperty("email_verified");
    readAuthSession.mockResolvedValueOnce(activeSession);
    const issued = await getConvexToken(convexTokenRequest);
    expect(issued.status).toBe(200);
    const { token } = await issued.json();
    const { payload: issuedPayload } = await jwtVerify(token, createLocalJWKSet(await publicJwks()));
    expect(issuedPayload).toMatchObject({ sub: googleIdentity.subject, pipelixr_user_id: userId });

    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "success", value: false }));
    const revoked = await readSession({ id: googleIdentity.subject, convexUserId: userId });
    const revokedSession = await revoked.json();
    expect(revokedSession).toBeNull();
    expect(revoked.headers.get("set-cookie")).toContain("Max-Age=0");
    readAuthSession.mockResolvedValueOnce(revokedSession);
    expect((await getConvexToken(convexTokenRequest)).status).toBe(401);

    const unbound = await readSession({ id: googleIdentity.subject });
    expect(await unbound.json()).toBeNull();
    expect(unbound.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects old Google tokens after deletion even when the same Google account signs up again", async () => {
    const harness = createHarness();
    const google = harness.withIdentity(googleIdentity);
    const userId = await google.mutation(api.users.upsertGoogleUser, {});
    const session = harness.withIdentity({ ...googleIdentity, pipelixr_user_id: userId });
    const workspace = { name: "Synthetic workspace" };

    await expect(google.query(api.users.sessionActive, {})).resolves.toBe(false);
    await expect(google.mutation(api.foundation.createBusiness, workspace)).rejects.toThrow("UNAUTHENTICATED");
    await expect(session.query(api.users.sessionActive, {})).resolves.toBe(true);
    await expect(session.query(api.foundation.workspace, {})).resolves.toBeNull();
    await harness.run((ctx) => ctx.db.delete(userId));
    await expect(session.query(api.users.sessionActive, {})).resolves.toBe(false);
    await expect(session.query(api.foundation.workspace, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(session.mutation(api.foundation.createBusiness, workspace)).rejects.toThrow("UNAUTHENTICATED");

    const replacementId = await google.mutation(api.users.upsertGoogleUser, {});
    expect(replacementId).not.toBe(userId);
    await expect(session.mutation(api.foundation.createBusiness, workspace)).rejects.toThrow("UNAUTHENTICATED");
    await expect(harness.withIdentity({ ...googleIdentity, pipelixr_user_id: replacementId }).mutation(api.foundation.createBusiness, workspace)).resolves.toEqual(expect.any(String));
  });

  it("rejects deleted or mismatched credential account tokens, including for allowlisted admins", async () => {
    const harness = createHarness();
    const userId = await harness.run((ctx) => ctx.db.insert("users", { name: "Operator", password: "synthetic-test-hash" }));
    const subject = `credentials:${userId}`;
    vi.stubEnv("ADMIN_USER_IDS", subject);
    const identity = { issuer: googleIdentity.issuer, subject, pipelixr_user_id: userId };
    const session = harness.withIdentity(identity);

    await expect(session.query(api.users.sessionActive, {})).resolves.toBe(true);
    await expect(session.query(api.admin.access, {})).resolves.toEqual({ isAdmin: true, configured: true });
    await expect(harness.withIdentity({ ...identity, subject: googleIdentity.subject }).query(api.users.sessionActive, {})).resolves.toBe(false);
    await harness.run((ctx) => ctx.db.delete(userId));
    await expect(session.query(api.users.sessionActive, {})).resolves.toBe(false);
    await expect(session.query(api.admin.overview, { rangeDays: 30 })).rejects.toThrow("ADMIN_FORBIDDEN");
  });
});
