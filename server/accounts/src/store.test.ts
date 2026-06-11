import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryUserStore, lbsk } from "./store.ts";
import type { StoredGame } from "./store.ts";

function makeUser(userId: string) {
  return {
    userId,
    email: "test@example.com",
    displayName: "Test User",
    avatarUrl: null,
    createdAt: "2025-01-01T00:00:00Z",
    stats: {} as Record<string, number>,
  };
}

function makeGame(overrides: { gameId: string; endedAt: string } & Partial<StoredGame>): StoredGame {
  const { gameId, endedAt, ...rest } = overrides;
  return {
    gameId,
    mode: "vsBot",
    difficulty: "medium",
    playerColor: "white",
    opponent: "Bot",
    moves: ["e2e4", "e7e5"],
    resultType: "checkmate",
    winner: "white",
    endedAt,
    ...rest,
  };
}

describe("InMemoryUserStore — putGame / listGames", () => {
  it("putGame then listGames → newest-first by endedAt", async () => {
    const store = new InMemoryUserStore();
    await store.putUser(makeUser("u1"));

    // Insert out of order
    const g1 = makeGame({ gameId: "g1", endedAt: "2025-01-01T10:00:00Z" });
    const g3 = makeGame({ gameId: "g3", endedAt: "2025-01-03T10:00:00Z" });
    const g2 = makeGame({ gameId: "g2", endedAt: "2025-01-02T10:00:00Z" });

    await store.putGame("u1", g1);
    await store.putGame("u1", g3);
    await store.putGame("u1", g2);

    const page = await store.listGames("u1", 20, null);
    assert.equal(page.games.length, 3);
    assert.equal(page.games[0].gameId, "g3");
    assert.equal(page.games[1].gameId, "g2");
    assert.equal(page.games[2].gameId, "g1");
    assert.equal(page.nextCursor, null);
  });

  it("pagination: 25 games → page 1 returns 20 + cursor; page 2 returns 5 + null cursor", async () => {
    const store = new InMemoryUserStore();
    await store.putUser(makeUser("u1"));

    for (let i = 1; i <= 25; i++) {
      const pad = String(i).padStart(2, "0");
      await store.putGame(
        "u1",
        makeGame({ gameId: `g${pad}`, endedAt: `2025-01-${pad}T10:00:00Z` })
      );
    }

    const page1 = await store.listGames("u1", 20, null);
    assert.equal(page1.games.length, 20);
    assert.ok(page1.nextCursor !== null, "expected non-null cursor after first page");
    // Newest first: g25 through g06
    assert.equal(page1.games[0].gameId, "g25");
    assert.equal(page1.games[19].gameId, "g06");

    const page2 = await store.listGames("u1", 20, page1.nextCursor);
    assert.equal(page2.games.length, 5);
    assert.equal(page2.nextCursor, null);
    assert.equal(page2.games[0].gameId, "g05");
    assert.equal(page2.games[4].gameId, "g01");
  });

  it("garbage cursor → treated as first page (no throw)", async () => {
    const store = new InMemoryUserStore();
    await store.putUser(makeUser("u1"));

    await store.putGame("u1", makeGame({ gameId: "g1", endedAt: "2025-01-01T10:00:00Z" }));

    const page = await store.listGames("u1", 20, "!!!");
    assert.equal(page.games.length, 1);
    assert.equal(page.nextCursor, null);
  });
});

describe("InMemoryUserStore — getGame", () => {
  it("getGame finds a game by gameId", async () => {
    const store = new InMemoryUserStore();
    await store.putUser(makeUser("u1"));
    const g = makeGame({ gameId: "abc-123", endedAt: "2025-03-01T00:00:00Z" });
    await store.putGame("u1", g);

    const result = await store.getGame("u1", "abc-123");
    assert.ok(result !== null);
    assert.equal(result.gameId, "abc-123");
  });

  it("getGame unknown id → null", async () => {
    const store = new InMemoryUserStore();
    await store.putUser(makeUser("u1"));
    const result = await store.getGame("u1", "nonexistent");
    assert.equal(result, null);
  });

  it("getGame other user's id → null", async () => {
    const store = new InMemoryUserStore();
    await store.putUser(makeUser("u1"));
    await store.putUser(makeUser("u2"));
    const g = makeGame({ gameId: "shared-id", endedAt: "2025-03-01T00:00:00Z" });
    await store.putGame("u2", g);

    // u1 should not see u2's game
    const result = await store.getGame("u1", "shared-id");
    assert.equal(result, null);
  });
});

describe("InMemoryUserStore — addStat", () => {
  it("addStat twice on bot_medium_w → stats.bot_medium_w === 2", async () => {
    const store = new InMemoryUserStore();
    await store.putUser(makeUser("u1"));

    await store.addStat("u1", "bot_medium_w");
    await store.addStat("u1", "bot_medium_w");

    const user = await store.getUser("u1");
    assert.ok(user !== null);
    assert.equal(user.stats["bot_medium_w"], 2);
  });

  it("addStat for a missing user throws", async () => {
    const store = new InMemoryUserStore();
    await assert.rejects(() => store.addStat("no-such-user", "bot_easy_w"));
  });
});

describe("lbsk", () => {
  it("lbsk(42, 'u1') → 'W#00000042#u1'", () => {
    assert.equal(lbsk(42, "u1"), "W#00000042#u1");
  });

  it("lbsk(100_000_000, 'u1') clamps to 'W#99999999#u1'", () => {
    assert.equal(lbsk(100_000_000, "u1"), "W#99999999#u1");
  });
});

describe("InMemoryUserStore — leaderboard", () => {
  it("three users → getLeaderboard returns 9/5/3 wins descending", async () => {
    const store = new InMemoryUserStore();
    await store.putUser({ userId: "a", email: "", displayName: "Alice", avatarUrl: null, createdAt: "", stats: { online_w: 5, online_l: 2 } });
    await store.putUser({ userId: "b", email: "", displayName: "Bob",   avatarUrl: null, createdAt: "", stats: { online_w: 3, online_l: 1 } });
    await store.putUser({ userId: "c", email: "", displayName: "Carol", avatarUrl: null, createdAt: "", stats: { online_w: 9, online_l: 1 } });
    await store.setLeaderboardEntry("a", 5);
    await store.setLeaderboardEntry("b", 3);
    await store.setLeaderboardEntry("c", 9);

    const rows = await store.getLeaderboard(100);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].wins, 9);
    assert.equal(rows[0].games, 10);
    assert.equal(rows[1].wins, 5);
    assert.equal(rows[1].games, 7);
    assert.equal(rows[2].wins, 3);
    assert.equal(rows[2].games, 4);
  });

  it("tie at 5 wins: userId 'zzz' before 'aaa' (userId descending tiebreak)", async () => {
    const store = new InMemoryUserStore();
    await store.putUser({ userId: "aaa", email: "", displayName: "A", avatarUrl: null, createdAt: "", stats: { online_w: 5 } });
    await store.putUser({ userId: "zzz", email: "", displayName: "Z", avatarUrl: null, createdAt: "", stats: { online_w: 5 } });
    await store.setLeaderboardEntry("aaa", 5);
    await store.setLeaderboardEntry("zzz", 5);

    const rows = await store.getLeaderboard(100);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].userId, "zzz");
    assert.equal(rows[1].userId, "aaa");
  });

  it("getLeaderboard(2) with 3 entries → 2 rows", async () => {
    const store = new InMemoryUserStore();
    for (const [id, w] of [["u1", 1], ["u2", 2], ["u3", 3]] as [string, number][]) {
      await store.putUser({ userId: id, email: "", displayName: id, avatarUrl: null, createdAt: "", stats: { online_w: w } });
      await store.setLeaderboardEntry(id, w);
    }
    const rows = await store.getLeaderboard(2);
    assert.equal(rows.length, 2);
  });

  it("monotonic guard: stale write ignored, then higher write accepted", async () => {
    const store = new InMemoryUserStore();
    await store.putUser({ userId: "u1", email: "", displayName: "U1", avatarUrl: null, createdAt: "", stats: { online_w: 6 } });
    await store.setLeaderboardEntry("u1", 5);
    await store.setLeaderboardEntry("u1", 4); // stale — should be ignored, no throw
    let rows = await store.getLeaderboard(100);
    assert.equal(rows[0].userId, "u1");
    // rank is by LBSK (wins=5 used to sort); display wins come from stats.online_w=6
    // verify the entry is still at the lb-registered wins level via lbsk sort
    // (the in-memory impl sorts by lbsk(wins, userId), where wins = lb.get(userId) = 5)
    await store.setLeaderboardEntry("u1", 6); // higher — should update
    rows = await store.getLeaderboard(100);
    assert.equal(rows[0].userId, "u1");
    // Display wins are read from stats map (6), not lb map
    assert.equal(rows[0].wins, 6);
  });

  it("user with stats but no setLeaderboardEntry call → not on board", async () => {
    const store = new InMemoryUserStore();
    await store.putUser({ userId: "ghost", email: "", displayName: "Ghost", avatarUrl: null, createdAt: "", stats: { online_w: 5 } });
    const rows = await store.getLeaderboard(100);
    assert.equal(rows.length, 0);
  });

  it("setLeaderboardEntry for missing user throws", async () => {
    const store = new InMemoryUserStore();
    await assert.rejects(() => store.setLeaderboardEntry("no-such-user", 1));
  });

  it("empty board → getLeaderboard returns []", async () => {
    const store = new InMemoryUserStore();
    const rows = await store.getLeaderboard(100);
    assert.deepEqual(rows, []);
  });
});

describe("InMemoryUserStore — same endedAt, different gameId", () => {
  it("two games with same endedAt but different gameId → both stored", async () => {
    const store = new InMemoryUserStore();
    await store.putUser(makeUser("u1"));

    const shared = "2025-06-01T00:00:00Z";
    await store.putGame("u1", makeGame({ gameId: "g-a", endedAt: shared }));
    await store.putGame("u1", makeGame({ gameId: "g-b", endedAt: shared }));

    const page = await store.listGames("u1", 20, null);
    assert.equal(page.games.length, 2);
    const ids = page.games.map((g) => g.gameId).sort();
    assert.deepEqual(ids, ["g-a", "g-b"]);
  });
});
