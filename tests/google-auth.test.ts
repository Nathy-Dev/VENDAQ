import { generateKeyPairSync } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import NextAuth, { type NextAuthConfig } from "next-auth";
import { describe, expect, it, vi } from "vitest";
import "../auth";
import { api } from "../convex/_generated/api";
import { publicJwks } from "../src/lib/convex-auth";
import { createHarness } from "./harness";

vi.mock("next-auth", () => ({ default: vi.fn(() => ({})) }));

const { callbacks } = vi.mocked(NextAuth).mock.calls[0][0] as NextAuthConfig;
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

describe("Google sign-in provisioning", () => {
  it("sends verified profile claims to Convex and keeps the existing session subject", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    vi.stubEnv("AUTH_JWT_PRIVATE_KEY", Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"));
    vi.stubEnv("AUTH_JWT_KEY_ID", "synthetic-key");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "success", value: null }));

    await expect(callbacks!.jwt!({ ...googleSignIn, token: {} })).resolves.toMatchObject({ id: googleIdentity.subject });
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
