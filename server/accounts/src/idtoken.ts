import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import type { Provider } from "./protocol.ts";

/** Identity extracted from a verified provider ID token. */
export interface IdpIdentity {
  provider: Provider;
  sub: string;
  /** Lowercased VERIFIED email, or null when absent/unverified.
   *  Apple omits email on logins after the first authorization. */
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

/** Key sources per provider — injectable so tests use a local JWKS. */
export type ProviderKeys = Record<Provider, JWTVerifyGetKey>;

const ISSUERS: Record<Provider, string[]> = {
  google: ["https://accounts.google.com", "accounts.google.com"],
  apple: ["https://appleid.apple.com"],
};

/** Module-level remote JWKS: cached across warm Lambda invocations. */
export const REMOTE_KEYS: ProviderKeys = {
  google: createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")),
  apple: createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys")),
};

/** Verify a provider ID token's signature, issuer, audience, and expiry.
 *  Throws (jose errors) on any failure. */
export async function verifyIdToken(
  provider: Provider,
  idToken: string,
  audience: string[],
  keys: ProviderKeys = REMOTE_KEYS
): Promise<IdpIdentity> {
  const { payload } = await jwtVerify(idToken, keys[provider], {
    issuer: ISSUERS[provider],
    audience,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat"],
    clockTolerance: "5s",
  });
  if (!payload.sub) throw new Error("id token missing sub");

  // Apple may serialize email_verified as the string "true".
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  const email =
    emailVerified && typeof payload.email === "string" && payload.email.length > 0
      ? payload.email.toLowerCase()
      : null;

  return {
    provider,
    sub: String(payload.sub),
    email,
    name: typeof payload.name === "string" && payload.name.length > 0 ? payload.name : null,
    avatarUrl: typeof payload.picture === "string" ? payload.picture : null,
  };
}
