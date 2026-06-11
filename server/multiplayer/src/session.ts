import { jwtVerify } from "jose";

// NOTE: deliberate copy of server/accounts/src/session.ts (verify half only).
// Two independently-deployed Lambdas sharing ~25 lines does not justify a
// shared package; extract if a third consumer appears. Keep in sync with
// the accounts issuer (HS256, sub = userId, exp required).
const ALG = "HS256";

/** Verify a session JWT and return the userId. Throws on any failure. */
export async function verifySession(secret: string, token: string): Promise<string> {
  if (!secret) throw new Error("session secret is not configured");
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: [ALG], requiredClaims: ["exp"] });
  if (!payload.sub) throw new Error("missing sub");
  return payload.sub;
}
