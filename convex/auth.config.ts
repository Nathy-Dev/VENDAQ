import type { AuthConfig } from "convex/server";

const issuer = process.env.AUTH_JWT_ISSUER;
const jwks = process.env.AUTH_JWT_JWKS;

export default {
  providers: issuer && jwks ? [{
    type: "customJwt",
    issuer,
    jwks,
    applicationID: "pipelixr",
    algorithm: "RS256",
  }] : [],
} satisfies AuthConfig;
