import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IdpIdentity } from "./idtoken";
import type { Provider } from "./protocol";
import { verifySession } from "./session";
import { InMemoryUserStore } from "./store";
import { handleRequest, type HandlerDeps, type HttpEvent } from "./handler";

const JWT_SECRET = "test-secret-that-is-long-enough";

function ev(routeKey: string, body?: unknown, headers: Record<string, string> = {}): HttpEvent {
  return {
    routeKey,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function makeVerifyStub(identity: IdpIdentity): HandlerDeps["verify"] {
  return async (_provider: Provider, _idToken: string, _audience: string[]) => identity;
}

function makeThrowingVerify(message: string): HandlerDeps["verify"] {
  return async () => {
    throw new Error(message);
  };
}

function googleIdentity(userId = "google-sub-123"): IdpIdentity {
  return {
    provider: "google",
    sub: userId,
    email: "alice@example.com",
    name: "Alice",
    avatarUrl: "https://example.com/pic.jpg",
  };
}

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    store: new InMemoryUserStore(),
    jwtSecret: JWT_SECRET,
    audiences: {
      google: ["google-client-id"],
      apple: ["apple-bundle-id"],
    },
    verify: makeVerifyStub(googleIdentity()),
    ...overrides,
  };
}

const NOW = new Date("2025-01-01T00:00:00Z");

describe("POST /v1/auth/login", () => {
  it("valid google token → 200 with token and profile", async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { token: string; profile: { userId: string } };
    assert.ok(typeof body.token === "string" && body.token.length > 0);
    assert.ok(typeof body.profile.userId === "string" && body.profile.userId.length > 0);

    // Token must be verifiable with the same secret
    const userId = await verifySession(JWT_SECRET, body.token);
    assert.equal(userId, body.profile.userId);
  });

  it("malformed body (missing idToken) → 400 with error field", async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google" }),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body) as { error: string };
    assert.ok(typeof body.error === "string" && body.error.length > 0);
  });

  it("unparseable JSON body → 400", async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      { routeKey: "POST /v1/auth/login", headers: {}, body: "NOT_JSON" },
      deps,
      NOW
    );
    assert.equal(res.statusCode, 400);
  });

  it("verify stub throws → 401", async () => {
    const deps = makeDeps({ verify: makeThrowingVerify("token invalid") });
    const res = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "bad" }),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body) as { error: string };
    // Security: error message must be our own short string, not the raw thrown message
    assert.equal(body.error, "invalid token");
  });

  it("empty audience list for google → 401 without calling verify", async () => {
    let verifyCalled = false;
    const verify: HandlerDeps["verify"] = async () => {
      verifyCalled = true;
      return googleIdentity();
    };
    const deps = makeDeps({
      audiences: { google: [], apple: ["apple-bundle-id"] },
      verify,
    });
    const res = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 401);
    assert.equal(verifyCalled, false);
    const body = JSON.parse(res.body) as { error: string };
    assert.equal(body.error, "provider not configured");
  });

  it("empty audience list for apple → 401 without calling verify", async () => {
    let verifyCalled = false;
    const verify: HandlerDeps["verify"] = async () => {
      verifyCalled = true;
      return googleIdentity();
    };
    const deps = makeDeps({
      audiences: { google: ["google-client-id"], apple: [] },
      verify,
    });
    const res = await handleRequest(
      ev("POST /v1/auth/login", { provider: "apple", idToken: "tok" }),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 401);
    assert.equal(verifyCalled, false);
    const body = JSON.parse(res.body) as { error: string };
    assert.equal(body.error, "provider not configured");
  });
});

describe("GET /v1/me", () => {
  it("valid token → 200 with profile", async () => {
    const deps = makeDeps();
    // First login to get a token
    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token } = JSON.parse(loginRes.body) as { token: string };

    const meRes = await handleRequest(
      ev("GET /v1/me", undefined, authHeader(token)),
      deps,
      NOW
    );
    assert.equal(meRes.statusCode, 200);
    const body = JSON.parse(meRes.body) as { profile: { displayName: string; email: string } };
    assert.equal(body.profile.displayName, "Alice");
    assert.equal(body.profile.email, "alice@example.com");
  });

  it("missing Authorization → 401", async () => {
    const deps = makeDeps();
    const res = await handleRequest(ev("GET /v1/me"), deps, NOW);
    assert.equal(res.statusCode, 401);
  });

  it("garbage Bearer token → 401", async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      ev("GET /v1/me", undefined, { authorization: "Bearer garbage" }),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 401);
  });

  it("valid token whose user was deleted → 401", async () => {
    const store = new InMemoryUserStore();
    const deps = makeDeps({ store });

    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token, profile } = JSON.parse(loginRes.body) as { token: string; profile: { userId: string } };

    // Simulate user deletion by creating a fresh store (no user present)
    const freshDeps = makeDeps({ store: new InMemoryUserStore(), jwtSecret: JWT_SECRET });
    // Re-inject the same secret so the token is still structurally valid
    const res = await handleRequest(
      ev("GET /v1/me", undefined, authHeader(token)),
      { ...freshDeps, jwtSecret: JWT_SECRET },
      NOW
    );
    // The token itself is valid, but the user is missing in the fresh store → 401
    assert.equal(res.statusCode, 401);
    void profile; // used above
  });
});

describe("POST /v1/me", () => {
  it("valid displayName → 200 with trimmed/collapsed name", async () => {
    const deps = makeDeps();
    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token } = JSON.parse(loginRes.body) as { token: string };

    const res = await handleRequest(
      ev("POST /v1/me", { displayName: "  New   Name " }, authHeader(token)),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { profile: { displayName: string } };
    assert.equal(body.profile.displayName, "New Name");
  });

  it("31-char displayName → 400", async () => {
    const deps = makeDeps();
    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token } = JSON.parse(loginRes.body) as { token: string };

    const res = await handleRequest(
      ev("POST /v1/me", { displayName: "A".repeat(31) }, authHeader(token)),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 400);
  });

  it("empty displayName (whitespace only) → 400", async () => {
    const deps = makeDeps();
    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token } = JSON.parse(loginRes.body) as { token: string };

    const res = await handleRequest(
      ev("POST /v1/me", { displayName: "   " }, authHeader(token)),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 400);
  });

  it("missing Authorization on POST /v1/me → 401", async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      ev("POST /v1/me", { displayName: "Bob" }),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 401);
  });
});

describe("routing and content-type", () => {
  it("unknown route → 404 with error field", async () => {
    const deps = makeDeps();
    const res = await handleRequest(ev("GET /v1/unknown"), deps, NOW);
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body) as { error: string };
    assert.ok(typeof body.error === "string");
  });

  it("all responses carry content-type: application/json", async () => {
    const deps = makeDeps();
    const responses = await Promise.all([
      handleRequest(ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }), deps, NOW),
      handleRequest(ev("GET /v1/me"), deps, NOW),
      handleRequest(ev("POST /v1/me", { displayName: "X" }), deps, NOW),
      handleRequest(ev("GET /v1/unknown"), deps, NOW),
    ]);
    for (const res of responses) {
      assert.equal(res.headers["content-type"], "application/json");
    }
  });
});
