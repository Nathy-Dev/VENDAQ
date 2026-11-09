import { exportJWK, importPKCS8, SignJWT } from "jose";
import { createPublicKey } from "node:crypto";

async function signingKey() {
  const encoded = process.env.AUTH_JWT_PRIVATE_KEY;
  if (!encoded) throw new Error("AUTH_BRIDGE_NOT_CONFIGURED");
  return importPKCS8(Buffer.from(encoded, "base64").toString("utf8"), "RS256");
}

export async function mintConvexToken(subject: string) {
  const issuer = process.env.AUTH_JWT_ISSUER;
  const kid = process.env.AUTH_JWT_KEY_ID;
  if (!issuer || !kid || !/^(google|credentials):.+$/.test(subject)) throw new Error("AUTH_BRIDGE_NOT_CONFIGURED");
  return new SignJWT({}).setProtectedHeader({ alg: "RS256", kid, typ: "JWT" }).setSubject(subject).setIssuer(issuer).setAudience("pipelixr").setIssuedAt().setExpirationTime("5m").sign(await signingKey());
}

export async function publicJwks() {
  const encoded = process.env.AUTH_JWT_PRIVATE_KEY;
  const kid = process.env.AUTH_JWT_KEY_ID;
  if (!encoded || !kid) throw new Error("AUTH_BRIDGE_NOT_CONFIGURED");
  const publicKey = createPublicKey(Buffer.from(encoded, "base64").toString("utf8"));
  const jwk = await exportJWK(publicKey);
  return { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] };
}
