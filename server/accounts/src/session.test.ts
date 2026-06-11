import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateKeyPair, SignJWT, decodeJwt } from "jose";
import { issueSession, verifySession } from "./session.ts";

const SECRET = "test-secret-value-long-enough-for-hs256";

describe("session JWTs", () => {
  it("round-trip: issueSession then verifySession returns userId", async () => {
    const userId = "user-abc-123";
    const token = await issueSession(SECRET, userId);
    const returned = await verifySession(SECRET, token);
    assert.equal(returned, userId);
  });

  it("tampered token rejects", async () => {
    const token = await issueSession(SECRET, "user-xyz");
    // Tamper with the payload segment
    const parts = token.split(".");
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const modified = JSON.parse(payload);
    modified.sub = "hacker";
    parts[1] = Buffer.from(JSON.stringify(modified)).toString("base64url");
    const tampered = parts.join(".");
    await assert.rejects(() => verifySession(SECRET, tampered));
  });

  it("wrong secret rejects", async () => {
    const token = await issueSession(SECRET, "user-abc");
    await assert.rejects(() => verifySession("wrong-secret", token));
  });

  it("RS256-signed token is rejected (alg pinning)", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("some-user")
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(privateKey);
    await assert.rejects(() => verifySession(SECRET, token));
  });

  it("exp - iat equals 30 days in seconds", async () => {
    const token = await issueSession(SECRET, "user-timing");
    const payload = decodeJwt(token);
    assert.ok(payload.exp !== undefined, "exp should be set");
    assert.ok(payload.iat !== undefined, "iat should be set");
    const diff = payload.exp! - payload.iat!;
    assert.equal(diff, 30 * 24 * 3600);
  });
});
