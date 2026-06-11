import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const EXPIRES = "30d";

/** Issue a session JWT for a user. sub = userId; profile data stays in DynamoDB. */
export async function issueSession(secret: string, userId: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return await new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(EXPIRES)
    .sign(key);
}

/** Verify a session JWT and return the userId. Throws on any failure. */
export async function verifySession(secret: string, token: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
  if (!payload.sub) throw new Error("missing sub");
  return payload.sub;
}
