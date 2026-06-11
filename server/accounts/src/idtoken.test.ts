import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { verifyIdToken, type ProviderKeys } from "./idtoken.ts";

let keys: ProviderKeys;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

before(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  const jwks = createLocalJWKSet({ keys: [jwk] });
  keys = { google: jwks, apple: jwks };
});

function sign(claims: Record<string, unknown>, iss: string, aud: string) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject(String(claims.sub ?? "sub-1"))
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("verifyIdToken", () => {
  it("valid Google token returns identity with lowercased email, name, avatarUrl", async () => {
    const token = await sign(
      {
        email: "Alice@Example.com",
        email_verified: true,
        name: "Alice Example",
        picture: "https://example.com/pic.jpg",
      },
      "https://accounts.google.com",
      "client-a"
    );
    const identity = await verifyIdToken("google", token, ["client-a", "client-b"], keys);
    assert.equal(identity.provider, "google");
    assert.equal(identity.sub, "sub-1");
    assert.equal(identity.email, "alice@example.com");
    assert.equal(identity.name, "Alice Example");
    assert.equal(identity.avatarUrl, "https://example.com/pic.jpg");
  });

  it("Google iss without scheme (accounts.google.com) is also accepted", async () => {
    const token = await sign(
      { email: "bob@example.com", email_verified: true },
      "accounts.google.com",
      "client-a"
    );
    const identity = await verifyIdToken("google", token, ["client-a"], keys);
    assert.equal(identity.email, "bob@example.com");
  });

  it("valid Apple token with string email_verified returns email", async () => {
    const token = await sign(
      { email: "carol@example.com", email_verified: "true" },
      "https://appleid.apple.com",
      "client-a"
    );
    const identity = await verifyIdToken("apple", token, ["client-a"], keys);
    assert.equal(identity.email, "carol@example.com");
  });

  it("Apple token with no email returns null email", async () => {
    const token = await sign(
      {},
      "https://appleid.apple.com",
      "client-a"
    );
    const identity = await verifyIdToken("apple", token, ["client-a"], keys);
    assert.equal(identity.email, null);
  });

  it("email_verified false results in null email", async () => {
    const token = await sign(
      { email: "dave@example.com", email_verified: false },
      "https://accounts.google.com",
      "client-a"
    );
    const identity = await verifyIdToken("google", token, ["client-a"], keys);
    assert.equal(identity.email, null);
  });

  it("wrong audience rejects", async () => {
    const token = await sign(
      { email: "eve@example.com", email_verified: true },
      "https://accounts.google.com",
      "other-client"
    );
    await assert.rejects(() => verifyIdToken("google", token, ["client-a", "client-b"], keys));
  });

  it("wrong issuer rejects", async () => {
    const token = await sign(
      { email: "frank@example.com", email_verified: true },
      "https://evil.example.com",
      "client-a"
    );
    await assert.rejects(() => verifyIdToken("google", token, ["client-a"], keys));
  });

  it("expired token rejects", async () => {
    const token = await new SignJWT({ email: "grace@example.com", email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://accounts.google.com")
      .setAudience("client-a")
      .setSubject("sub-exp")
      .setIssuedAt()
      .setExpirationTime("-5m")
      .sign(privateKey);
    await assert.rejects(() => verifyIdToken("google", token, ["client-a"], keys));
  });

  it("audience matches the second configured client ID", async () => {
    const token = await sign(
      { email: "henry@example.com", email_verified: true },
      "https://accounts.google.com",
      "client-b"
    );
    const identity = await verifyIdToken("google", token, ["client-a", "client-b"], keys);
    assert.equal(identity.email, "henry@example.com");
  });
});
