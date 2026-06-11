import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IdpIdentity } from "./idtoken";
import type { Provider } from "./protocol";
import { issueSession, verifySession } from "./session";
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

// ---------------------------------------------------------------------------
// GET /v1/leaderboard
// ---------------------------------------------------------------------------

async function seedBoardUser(
  store: InMemoryUserStore,
  userId: string,
  opts: { displayName?: string; wins?: number; losses?: number; draws?: number; botWins?: number; avatarUrl?: string | null } = {}
): Promise<void> {
  const wins = opts.wins ?? 0;
  const losses = opts.losses ?? 0;
  const draws = opts.draws ?? 0;
  const stats: Record<string, number> = {};
  if (wins > 0) stats.online_w = wins;
  if (losses > 0) stats.online_l = losses;
  if (draws > 0) stats.online_d = draws;
  if (opts.botWins != null) stats.bot_medium_w = opts.botWins;
  await store.putUser({
    userId,
    email: `${userId}@test.com`,
    displayName: opts.displayName ?? userId,
    avatarUrl: opts.avatarUrl ?? null,
    createdAt: "2025-01-01T00:00:00Z",
    stats,
  });
  if (wins > 0) {
    await store.setLeaderboardEntry(userId, wins);
  }
}

describe("GET /v1/leaderboard — anonymous", () => {
  it("no Authorization → 200, entries ranked by wins descending, me: null", async () => {
    const store = new InMemoryUserStore();
    const deps = makeDeps({ store });
    await seedBoardUser(store, "u1", { wins: 3 });
    await seedBoardUser(store, "u2", { wins: 9 });
    await seedBoardUser(store, "u3", { wins: 5 });

    const res = await handleRequest(ev("GET /v1/leaderboard"), deps, NOW);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { entries: { rank: number; wins: number; displayName: string }[]; me: null };
    assert.equal(body.me, null);
    assert.equal(body.entries.length, 3);
    assert.equal(body.entries[0].rank, 1);
    assert.equal(body.entries[0].wins, 9);
    assert.equal(body.entries[1].rank, 2);
    assert.equal(body.entries[1].wins, 5);
    assert.equal(body.entries[2].rank, 3);
    assert.equal(body.entries[2].wins, 3);
  });

  it("entries have exactly the right shape: no userId, no bot_* keys", async () => {
    const store = new InMemoryUserStore();
    const deps = makeDeps({ store });
    await seedBoardUser(store, "u1", { wins: 5, botWins: 99, displayName: "Alice" });

    const res = await handleRequest(ev("GET /v1/leaderboard"), deps, NOW);
    const body = JSON.parse(res.body) as { entries: Record<string, unknown>[] };
    assert.equal(body.entries.length, 1);
    const entry = body.entries[0];
    const serialized = JSON.stringify(body);

    // Shape check
    assert.equal(typeof entry.rank, "number");
    assert.equal(typeof entry.displayName, "string");
    assert.ok("avatarUrl" in entry);
    assert.equal(typeof entry.wins, "number");
    assert.equal(typeof entry.games, "number");

    // userId must not appear
    assert.equal("userId" in entry, false);
    // bot_* counters must not leak for other users
    assert.equal(serialized.includes("bot_"), false);
  });

  it("101+ seeded users → exactly 100 entries", async () => {
    const store = new InMemoryUserStore();
    const deps = makeDeps({ store });
    for (let i = 1; i <= 101; i++) {
      await seedBoardUser(store, `user${i}`, { wins: i });
    }

    const res = await handleRequest(ev("GET /v1/leaderboard"), deps, NOW);
    const body = JSON.parse(res.body) as { entries: unknown[] };
    assert.equal(body.entries.length, 100);
  });

  it("empty board → 200, entries: []", async () => {
    const deps = makeDeps();
    const res = await handleRequest(ev("GET /v1/leaderboard"), deps, NOW);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { entries: unknown[]; me: null };
    assert.deepEqual(body.entries, []);
    assert.equal(body.me, null);
  });

  it("anonymous response has cache-control: public, max-age=60 and vary: Authorization", async () => {
    const deps = makeDeps();
    const res = await handleRequest(ev("GET /v1/leaderboard"), deps, NOW);
    assert.equal(res.headers["cache-control"], "public, max-age=60");
    assert.equal(res.headers["vary"], "Authorization");
  });
});

describe("GET /v1/leaderboard — authenticated", () => {
  it("valid token, caller in top 100 → me.rank equals position, me.stats has full map, private cache", async () => {
    const store = new InMemoryUserStore();
    const deps = makeDeps({ store });

    // Create the caller via login so we have a real userId
    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token, profile } = JSON.parse(loginRes.body) as { token: string; profile: { userId: string } };

    // Give the caller some stats then seed the board
    const callerUser = await store.getUser(profile.userId);
    assert.ok(callerUser);
    await store.putUser({ ...callerUser, stats: { online_w: 5, online_l: 2, bot_medium_w: 3 } });
    await store.setLeaderboardEntry(profile.userId, 5);

    // Another user ranked above
    await seedBoardUser(store, "top-user", { wins: 9 });

    const res = await handleRequest(ev("GET /v1/leaderboard", undefined, authHeader(token)), deps, NOW);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as {
      entries: { rank: number; wins: number }[];
      me: { rank: number | null; wins: number; games: number; stats: Record<string, number> } | null;
    };

    assert.ok(body.me !== null, "me should not be null for valid token");
    assert.equal(body.me.rank, 2); // top-user has 9 wins, caller has 5
    assert.equal(body.me.wins, 5);
    assert.equal(body.me.games, 7);
    assert.equal(body.me.stats.bot_medium_w, 3);
    assert.equal(res.headers["cache-control"], "private, max-age=60");
    assert.equal(res.headers["vary"], "Authorization");
  });

  it("valid token, caller NOT on board (only bot stats) → me.rank === null, correct wins/games", async () => {
    const store = new InMemoryUserStore();
    const deps = makeDeps({ store });

    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token, profile } = JSON.parse(loginRes.body) as { token: string; profile: { userId: string } };

    // Give caller only bot stats — no online wins, not on the board
    const callerUser = await store.getUser(profile.userId);
    assert.ok(callerUser);
    await store.putUser({ ...callerUser, stats: { bot_medium_w: 7, online_l: 2 } });

    await seedBoardUser(store, "board-user", { wins: 3 });

    const res = await handleRequest(ev("GET /v1/leaderboard", undefined, authHeader(token)), deps, NOW);
    const body = JSON.parse(res.body) as {
      me: { rank: number | null; wins: number; games: number } | null;
    };
    assert.ok(body.me !== null);
    assert.equal(body.me.rank, null);
    assert.equal(body.me.wins, 0);
    assert.equal(body.me.games, 2); // only online_l counted
  });

  it("garbage token → 200, me: null, public cache header (never 401)", async () => {
    const deps = makeDeps();
    await seedBoardUser(deps.store as InMemoryUserStore, "u1", { wins: 1 });
    const res = await handleRequest(
      ev("GET /v1/leaderboard", undefined, { authorization: "Bearer garbage-token" }),
      deps,
      NOW
    );
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { me: null };
    assert.equal(body.me, null);
    assert.equal(res.headers["cache-control"], "public, max-age=60");
  });

  it("bot_* keys do not appear in entries for other users even when me has them", async () => {
    const store = new InMemoryUserStore();
    const deps = makeDeps({ store });

    const loginRes = await handleRequest(
      ev("POST /v1/auth/login", { provider: "google", idToken: "tok" }),
      deps,
      NOW
    );
    const { token, profile } = JSON.parse(loginRes.body) as { token: string; profile: { userId: string } };

    // Another board user has bot stats
    const otherId = "other-user";
    await store.putUser({
      userId: otherId,
      email: "",
      displayName: "Other",
      avatarUrl: null,
      createdAt: "",
      stats: { online_w: 7, bot_hard_w: 50 },
    });
    await store.setLeaderboardEntry(otherId, 7);

    const callerUser = await store.getUser(profile.userId);
    assert.ok(callerUser);
    await store.putUser({ ...callerUser, stats: { online_w: 3, bot_medium_w: 2 } });
    await store.setLeaderboardEntry(profile.userId, 3);

    const res = await handleRequest(ev("GET /v1/leaderboard", undefined, authHeader(token)), deps, NOW);
    const body = JSON.parse(res.body) as { entries: Record<string, unknown>[] };

    // Find the "other-user" entry
    const otherEntry = body.entries.find((e) => e.displayName === "Other");
    assert.ok(otherEntry, "other user should be on the board");
    // Serialized entries should not contain bot_hard_w
    const entriesStr = JSON.stringify(body.entries);
    assert.equal(entriesStr.includes("bot_hard_w"), false);
  });
});
