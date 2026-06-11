import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RoomState, Seat } from "./room";
import type { OnlineGameRecord, UserGamesWriter } from "./record";
import { recordFinishedGame } from "./record";

/** Fake writer that captures all calls. */
class FakeWriter implements UserGamesWriter {
  games: { userId: string; game: OnlineGameRecord }[] = [];
  stats: { userId: string; key: string }[] = [];
  lbCalls: { userId: string; wins: number }[] = [];
  shouldThrowForUserId: string | null = null;
  /** When set, setLeaderboardEntry throws for any userId */
  shouldThrowLbForUserId: string | null = null;

  private counts = new Map<string, number>();

  async putGame(userId: string, game: OnlineGameRecord): Promise<void> {
    if (this.shouldThrowForUserId === userId) throw new Error("simulated write failure");
    this.games.push({ userId, game });
  }
  async addStat(userId: string, key: string): Promise<number> {
    if (this.shouldThrowForUserId === userId) throw new Error("simulated stat failure");
    this.stats.push({ userId, key });
    const mapKey = `${userId}:${key}`;
    const next = (this.counts.get(mapKey) ?? 0) + 1;
    this.counts.set(mapKey, next);
    return next;
  }
  async setLeaderboardEntry(userId: string, wins: number): Promise<void> {
    if (this.shouldThrowLbForUserId === userId) throw new Error("simulated lb failure");
    this.lbCalls.push({ userId, wins });
  }
}

function seat(name: string, userId?: string): Seat {
  return { token: "tok", name, connId: "c", connected: true, ...(userId ? { userId } : {}) };
}

function finishedRoom(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomId: "R",
    moves: ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"],
    status: "finished",
    white: seat("Alice", "u-alice"),
    black: seat("Bob", "u-bob"),
    spectators: [],
    rematchOfferedBy: null,
    result: { type: "checkmate", winner: "white" },
    createdAt: 1000,
    updatedAt: 2000,
    ttl: 99999,
    ...overrides,
  };
}

describe("recordFinishedGame", () => {
  it("checkmate white wins: two putGame calls with correct fields; white gets online_w, black gets online_l", async () => {
    const writer = new FakeWriter();
    const room = finishedRoom();
    await recordFinishedGame(writer, room, 3000);

    assert.equal(writer.games.length, 2);
    assert.equal(writer.stats.length, 2);

    const whiteGame = writer.games.find((g) => g.userId === "u-alice");
    const blackGame = writer.games.find((g) => g.userId === "u-bob");
    assert.ok(whiteGame, "should have a record for white");
    assert.ok(blackGame, "should have a record for black");

    // Same gameId for both
    assert.equal(whiteGame!.game.gameId, blackGame!.game.gameId);

    // White's record
    assert.equal(whiteGame!.game.mode, "online");
    assert.equal(whiteGame!.game.playerColor, "white");
    assert.equal(whiteGame!.game.opponent, "Bob");
    assert.equal(whiteGame!.game.winner, "white");
    assert.equal(whiteGame!.game.resultType, "checkmate");
    assert.equal(whiteGame!.game.difficulty, null);
    assert.deepEqual(whiteGame!.game.moves, room.moves);

    // Black's record
    assert.equal(blackGame!.game.playerColor, "black");
    assert.equal(blackGame!.game.opponent, "Alice");
    assert.equal(blackGame!.game.winner, "white");

    // Stats
    const whiteStat = writer.stats.find((s) => s.userId === "u-alice");
    const blackStat = writer.stats.find((s) => s.userId === "u-bob");
    assert.equal(whiteStat?.key, "online_w");
    assert.equal(blackStat?.key, "online_l");
  });

  it("stalemate: winner is null and both get online_d", async () => {
    const writer = new FakeWriter();
    const room = finishedRoom({
      result: { type: "stalemate" },
    });
    await recordFinishedGame(writer, room, 3000);

    assert.equal(writer.games.length, 2);
    assert.equal(writer.games[0].game.winner, null);
    assert.equal(writer.games[1].game.winner, null);

    assert.ok(writer.stats.every((s) => s.key === "online_d"), "both should get online_d");
  });

  it("one guest seat: exactly one putGame and one addStat", async () => {
    const writer = new FakeWriter();
    const room = finishedRoom({
      black: seat("Bob"), // no userId = guest
    });
    await recordFinishedGame(writer, room, 3000);

    assert.equal(writer.games.length, 1);
    assert.equal(writer.stats.length, 1);
    assert.equal(writer.games[0].userId, "u-alice");
  });

  it("both guests: no calls at all", async () => {
    const writer = new FakeWriter();
    const room = finishedRoom({
      white: seat("Alice"), // no userId
      black: seat("Bob"), // no userId
    });
    await recordFinishedGame(writer, room, 3000);

    assert.equal(writer.games.length, 0);
    assert.equal(writer.stats.length, 0);
  });

  it("ongoing result: no calls", async () => {
    const writer = new FakeWriter();
    const room = finishedRoom({
      status: "active",
      result: { type: "ongoing" },
    });
    await recordFinishedGame(writer, room, 3000);

    assert.equal(writer.games.length, 0);
  });

  it("a throwing putGame for player one still attempts player two (per-player try/catch)", async () => {
    const writer = new FakeWriter();
    writer.shouldThrowForUserId = "u-alice"; // white throws
    const room = finishedRoom();
    // Should not throw
    await assert.doesNotReject(() => recordFinishedGame(writer, room, 3000));
    // Black's record still written
    const blackGame = writer.games.find((g) => g.userId === "u-bob");
    assert.ok(blackGame, "black's record should still be written");
  });

  it("checkmate white wins: exactly one setLeaderboardEntry for the winner with wins === 1", async () => {
    const writer = new FakeWriter();
    const room = finishedRoom();
    await recordFinishedGame(writer, room, 3000);

    assert.equal(writer.lbCalls.length, 1, "exactly one leaderboard call");
    assert.equal(writer.lbCalls[0].userId, "u-alice", "winner's userId");
    assert.equal(writer.lbCalls[0].wins, 1, "post-increment count is 1");
  });

  it("second win for same user: setLeaderboardEntry carries wins === 2", async () => {
    const writer = new FakeWriter();
    const room1 = finishedRoom();
    const room2 = finishedRoom({ roomId: "R2" });
    await recordFinishedGame(writer, room1, 3000);
    await recordFinishedGame(writer, room2, 4000);

    assert.equal(writer.lbCalls.length, 2);
    assert.equal(writer.lbCalls[0].wins, 1, "first win count is 1");
    assert.equal(writer.lbCalls[1].wins, 2, "second win count is 2 (flows from addStat return)");
  });

  it("stalemate: zero setLeaderboardEntry calls (draws never touch LBSK)", async () => {
    const writer = new FakeWriter();
    const room = finishedRoom({ result: { type: "stalemate" } });
    await recordFinishedGame(writer, room, 3000);

    assert.equal(writer.lbCalls.length, 0, "no leaderboard calls for draws");
  });

  it("winner is a guest: no leaderboard calls", async () => {
    const writer = new FakeWriter();
    const room = finishedRoom({
      white: seat("Alice"), // no userId = guest, but white wins
    });
    await recordFinishedGame(writer, room, 3000);

    assert.equal(writer.lbCalls.length, 0, "no leaderboard call when winner is a guest");
  });

  it("setLeaderboardEntry throws for winner: winner's putGame+addStat happened and loser's calls still land", async () => {
    const writer = new FakeWriter();
    writer.shouldThrowLbForUserId = "u-alice"; // winner's lb call throws
    const room = finishedRoom();
    // Should not propagate
    await assert.doesNotReject(() => recordFinishedGame(writer, room, 3000));
    // Winner's game and stat were already recorded before lb failure
    assert.ok(writer.games.find((g) => g.userId === "u-alice"), "winner putGame landed");
    assert.ok(writer.stats.find((s) => s.userId === "u-alice" && s.key === "online_w"), "winner addStat landed");
    // Loser's records also landed
    assert.ok(writer.games.find((g) => g.userId === "u-bob"), "loser putGame landed");
    assert.ok(writer.stats.find((s) => s.userId === "u-bob" && s.key === "online_l"), "loser addStat landed");
  });
});
