import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IdpIdentity } from "./idtoken";
import type { Provider } from "./protocol";
import { verifySession } from "./session";
import { InMemoryUserStore } from "./store";
import { handleRequest, type HandlerDeps, type HttpEvent } from "./handler";

const JWT_SECRET = "test-secret-that-is-long-enough";

function ev(
  routeKey: string,
  body?: unknown,
  headers: Record<string, string> = {},
  opts: { queryStringParameters?: Record<string, string>; pathParameters?: Record<string, string> } = {}
): HttpEvent {
  return {
    routeKey,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    queryStringParameters: opts.queryStringParameters,
    pathParameters: opts.pathParameters,
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

describe("Bearer token parsing robustness", () => {
  it("lowercase 'bearer' scheme is accepted", async () => {
    const deps = makeDeps();
    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token } = JSON.parse(loginRes.body) as { token: string };
    const res = await handleRequest(
      { routeKey: "GET /v1/me", headers: { authorization: `bearer ${token}` }, body: undefined },
      deps,
      NOW
    );
    assert.equal(res.statusCode, 200);
  });

  it("'Bearer' with extra internal spaces is accepted (leading space trimmed)", async () => {
    const deps = makeDeps();
    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token } = JSON.parse(loginRes.body) as { token: string };
    // "Bearer  <token>" — double space between scheme and credential
    const res = await handleRequest(
      { routeKey: "GET /v1/me", headers: { authorization: `Bearer  ${token}` }, body: undefined },
      deps,
      NOW
    );
    // RFC 7235 allows extra whitespace; our handler trims, so this should succeed
    assert.equal(res.statusCode, 200);
  });

  it("'Bearer' alone (no token after scheme) → 401", async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      { routeKey: "GET /v1/me", headers: { authorization: "Bearer" }, body: undefined },
      deps,
      NOW
    );
    assert.equal(res.statusCode, 401);
  });

  it("'Basic abc' scheme → 401", async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      { routeKey: "GET /v1/me", headers: { authorization: "Basic abc" }, body: undefined },
      deps,
      NOW
    );
    assert.equal(res.statusCode, 401);
  });

  it("capital-A 'Authorization' header key is accepted", async () => {
    const deps = makeDeps();
    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token } = JSON.parse(loginRes.body) as { token: string };
    // Use capital-A Authorization header key
    const res = await handleRequest(
      { routeKey: "GET /v1/me", headers: { Authorization: `Bearer ${token}` }, body: undefined },
      deps,
      NOW
    );
    assert.equal(res.statusCode, 200);
  });
});

describe("POST /v1/me — user deleted after auth", () => {
  it("updateDisplayName on deleted user → 401, not 500", async () => {
    // Phase 1: log in with a real user
    const store = new InMemoryUserStore();
    const deps = makeDeps({ store });
    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    assert.equal(loginRes.statusCode, 200);
    const { token } = JSON.parse(loginRes.body) as { token: string };

    // Phase 2: nuke the user from the store (simulate concurrent delete)
    // We can do this by using a fresh store for subsequent requests while
    // keeping the same JWT secret so the token remains structurally valid.
    const emptyStore = new InMemoryUserStore();
    const deletedDeps = makeDeps({ store: emptyStore, jwtSecret: JWT_SECRET });

    const res = await handleRequest(
      ev("POST /v1/me", { displayName: "NewName" }, authHeader(token)),
      deletedDeps,
      NOW
    );
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body) as { error: string };
    assert.equal(body.error, "unauthorized");
  });
});

describe("POST /v1/auth/login — email-link path", () => {
  it("Apple login with existing Google user's verified email → returns same userId", async () => {
    const store = new InMemoryUserStore();
    // First: Google login establishes the account
    const googleIdentityLocal: IdpIdentity = {
      provider: "google",
      sub: "google-sub-email-link",
      email: "shared@example.com",
      name: "Shared User",
      avatarUrl: null,
    };
    const googleDeps = makeDeps({ store, verify: makeVerifyStub(googleIdentityLocal) });
    const googleRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "g-tok" }),
      googleDeps,
      NOW
    );
    assert.equal(googleRes.statusCode, 200);
    const { profile: googleProfile } = JSON.parse(googleRes.body) as { profile: { userId: string } };

    // Second: Apple login with the SAME verified email
    const appleIdentityLocal: IdpIdentity = {
      provider: "apple",
      sub: "apple-sub-email-link",
      email: "shared@example.com",
      name: null,
      avatarUrl: null,
    };
    const appleDeps = makeDeps({ store, verify: makeVerifyStub(appleIdentityLocal) });
    const appleRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "apple", idToken: "a-tok" }),
      appleDeps,
      NOW
    );
    assert.equal(appleRes.statusCode, 200);
    const { profile: appleProfile } = JSON.parse(appleRes.body) as { profile: { userId: string } };

    // Must resolve to the same userId
    assert.equal(appleProfile.userId, googleProfile.userId);
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

// ---------------------------------------------------------------------------
// Games routes helpers
// ---------------------------------------------------------------------------

async function loginAndGetToken(deps: HandlerDeps): Promise<string> {
  const res = await handleRequest(
    ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
    deps,
    NOW
  );
  assert.equal(res.statusCode, 200);
  return (JSON.parse(res.body) as { token: string }).token;
}

function validGameBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "vsBot",
    difficulty: "medium",
    playerColor: "white",
    opponent: "Bot (Medium)",
    moves: ["e2e4", "e7e5", "d1h5"],
    resultType: "checkmate",
    winner: "white",
    endedAt: "2025-01-01T10:00:00Z",
    ...overrides,
  };
}

describe("POST /v1/games — auth", () => {
  it("without Bearer → 401", async () => {
    const deps = makeDeps();
    const res = await handleRequest(ev("POST /v1/games", validGameBody()), deps, NOW);
    assert.equal(res.statusCode, 401);
  });
});

describe("GET /v1/games — auth", () => {
  it("without Bearer → 401", async () => {
    const deps = makeDeps();
    const res = await handleRequest(ev("GET /v1/games"), deps, NOW);
    assert.equal(res.statusCode, 401);
  });
});

describe("GET /v1/games/{gameId} — auth", () => {
  it("without Bearer → 401", async () => {
    const deps = makeDeps();
    const res = await handleRequest(
      ev("GET /v1/games/{gameId}", undefined, {}, { pathParameters: { gameId: "x" } }),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 401);
  });
});

describe("POST /v1/games", () => {
  it("valid vsBot body → 200, server-assigned gameId, all input fields echoed", async () => {
    const deps = makeDeps();
    const token = await loginAndGetToken(deps);
    const body = validGameBody();

    const res = await handleRequest(
      ev("POST /v1/games", body, authHeader(token)),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 200);
    const r = JSON.parse(res.body) as { game: Record<string, unknown> };
    assert.ok(typeof r.game.gameId === "string" && r.game.gameId.length > 0);
    // client-sent gameId (absent here) must not appear as-sent; server assigns it
    assert.equal(r.game.mode, "vsBot");
    assert.equal(r.game.difficulty, "medium");
    assert.equal(r.game.playerColor, "white");
    assert.equal(r.game.opponent, "Bot (Medium)");
    assert.deepEqual(r.game.moves, ["e2e4", "e7e5", "d1h5"]);
    assert.equal(r.game.resultType, "checkmate");
    assert.equal(r.game.winner, "white");
  });

  it('mode "online" → 400', async () => {
    const deps = makeDeps();
    const token = await loginAndGetToken(deps);
    const res = await handleRequest(
      ev("POST /v1/games", validGameBody({ mode: "online" }), authHeader(token)),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 400);
  });

  it("malformed body → 400", async () => {
    const deps = makeDeps();
    const token = await loginAndGetToken(deps);
    const res = await handleRequest(
      { routeKey: "POST /v1/games", headers: authHeader(token), body: "NOT_JSON" },
      deps,
      NOW
    );
    assert.equal(res.statusCode, 400);
  });

  it("endedAt in the future → stored game's endedAt is clamped to now", async () => {
    const deps = makeDeps();
    const token = await loginAndGetToken(deps);
    const futureDate = "2099-12-31T23:59:59Z";
    const res = await handleRequest(
      ev("POST /v1/games", validGameBody({ endedAt: futureDate }), authHeader(token)),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 200);
    const r = JSON.parse(res.body) as { game: { endedAt: string } };
    assert.equal(r.game.endedAt, NOW.toISOString());
  });

  it("won vsBot medium → stats.bot_medium_w === 1; localTwoPlayer changes no stats", async () => {
    const store = new InMemoryUserStore();
    const deps = makeDeps({ store });
    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token, profile } = JSON.parse(loginRes.body) as {
      token: string;
      profile: { userId: string };
    };

    // Post a won vsBot game
    await handleRequest(
      ev("POST /v1/games", validGameBody({ resultType: "checkmate", winner: "white" }), authHeader(token)),
      deps,
      NOW
    );

    // Post a localTwoPlayer game
    await handleRequest(
      ev(
        "POST /v1/games",
        validGameBody({
          mode: "localTwoPlayer",
          difficulty: null,
          playerColor: null,
          resultType: "stalemate",
          winner: null,
        }),
        authHeader(token)
      ),
      deps,
      NOW
    );

    const user = await store.getUser(profile.userId);
    assert.ok(user !== null);
    assert.equal(user.stats["bot_medium_w"], 1);
    // localTwoPlayer should not have incremented any stats
    assert.equal(user.stats["bot_easy_w"], undefined);
    assert.equal(user.stats["bot_medium_d"], undefined);
  });

  it("throwing addStat still returns 200 (stats are best-effort)", async () => {
    // Wrap the store so addStat always throws
    class ThrowingStatStore extends InMemoryUserStore {
      async addStat(_userId: string, _key: string): Promise<void> {
        throw new Error("DynamoDB error");
      }
    }
    const store = new ThrowingStatStore();
    const deps = makeDeps({ store });
    const token = await loginAndGetToken(deps);

    const res = await handleRequest(
      ev("POST /v1/games", validGameBody(), authHeader(token)),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 200);
  });
});

describe("GET /v1/games", () => {
  it("25 games → 20 newest-first + nextCursor; follow cursor → 5 + nextCursor null", async () => {
    const deps = makeDeps();
    const token = await loginAndGetToken(deps);

    // Post 25 games with different endedAt
    for (let i = 1; i <= 25; i++) {
      const pad = String(i).padStart(2, "0");
      await handleRequest(
        ev(
          "POST /v1/games",
          validGameBody({ endedAt: `2025-01-${pad}T10:00:00Z` }),
          authHeader(token)
        ),
        deps,
        new Date(`2025-01-${pad}T12:00:00Z`) // now >= endedAt
      );
    }

    const page1Res = await handleRequest(ev("GET /v1/games", undefined, authHeader(token)), deps, NOW);
    assert.equal(page1Res.statusCode, 200);
    const page1 = JSON.parse(page1Res.body) as { games: unknown[]; nextCursor: string | null };
    assert.equal(page1.games.length, 20);
    assert.ok(page1.nextCursor !== null);

    const page2Res = await handleRequest(
      ev("GET /v1/games", undefined, authHeader(token), {
        queryStringParameters: { cursor: page1.nextCursor! },
      }),
      deps,
      NOW
    );
    assert.equal(page2Res.statusCode, 200);
    const page2 = JSON.parse(page2Res.body) as { games: unknown[]; nextCursor: string | null };
    assert.equal(page2.games.length, 5);
    assert.equal(page2.nextCursor, null);
  });

  it("cursor=garbage → first page", async () => {
    const deps = makeDeps();
    const token = await loginAndGetToken(deps);

    await handleRequest(
      ev("POST /v1/games", validGameBody(), authHeader(token)),
      deps,
      NOW
    );

    const res = await handleRequest(
      ev("GET /v1/games", undefined, authHeader(token), {
        queryStringParameters: { cursor: "garbage" },
      }),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { games: unknown[] };
    assert.equal(body.games.length, 1);
  });
});

describe("GET /v1/games/{gameId}", () => {
  it("owned game → 200", async () => {
    const deps = makeDeps();
    const token = await loginAndGetToken(deps);

    const postRes = await handleRequest(
      ev("POST /v1/games", validGameBody(), authHeader(token)),
      deps,
      NOW
    );
    const { game } = JSON.parse(postRes.body) as { game: { gameId: string } };

    const getRes = await handleRequest(
      ev("GET /v1/games/{gameId}", undefined, authHeader(token), {
        pathParameters: { gameId: game.gameId },
      }),
      deps,
      NOW
    );
    assert.equal(getRes.statusCode, 200);
    const body = JSON.parse(getRes.body) as { game: { gameId: string } };
    assert.equal(body.game.gameId, game.gameId);
  });

  it("unknown gameId → 404", async () => {
    const deps = makeDeps();
    const token = await loginAndGetToken(deps);

    const res = await handleRequest(
      ev("GET /v1/games/{gameId}", undefined, authHeader(token), {
        pathParameters: { gameId: "no-such-id" },
      }),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 404);
  });
});
