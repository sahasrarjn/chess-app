import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SignJWT } from "jose";
import { verifySession } from "./session";

const SECRET = "test-secret-that-is-at-least-32-chars!!";

async function mintToken(
  secret: string,
  sub: string | undefined,
  expiresIn: string | null,
  omitExp = false
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  let builder = new SignJWT({}).setProtectedHeader({ alg: "HS256" });
  if (sub !== undefined) builder = builder.setSubject(sub);
  if (!omitExp && expiresIn !== null) builder = builder.setExpirationTime(expiresIn);
  return builder.sign(key);
}

describe("verifySession", () => {
  it("round-trip: returns the userId for a valid token", async () => {
    const token = await mintToken(SECRET, "user-abc", "1h");
    const userId = await verifySession(SECRET, token);
    assert.equal(userId, "user-abc");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await mintToken("wrong-secret-that-is-also-32-chars!!", "user-abc", "1h");
    await assert.rejects(() => verifySession(SECRET, token));
  });

  it("rejects an expired token", async () => {
    const token = await mintToken(SECRET, "user-abc", "1s");
    // Simulate past expiry by using an already-expired window
    // We need to actually wait or use a past-time token.
    // Use jose to create one with exp in the past by direct payload.
    const key = new TextEncoder().encode(SECRET);
    const expiredToken = await new SignJWT({ exp: Math.floor(Date.now() / 1000) - 60 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-abc")
      .sign(key);
    await assert.rejects(() => verifySession(SECRET, expiredToken));
  });

  it("rejects a token with missing sub", async () => {
    const token = await mintToken(SECRET, undefined, "1h");
    await assert.rejects(() => verifySession(SECRET, token));
  });

  it("rejects a token without exp", async () => {
    const token = await mintToken(SECRET, "user-abc", null, true);
    await assert.rejects(() => verifySession(SECRET, token));
  });

  it("throws when secret is empty", async () => {
    const token = await mintToken(SECRET, "user-abc", "1h");
    await assert.rejects(() => verifySession("", token), /not configured/);
  });
});
