import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RoomState, Seat } from "./room";
import type { OnlineGameRecord, UserGamesWriter } from "./record";
import { recordFinishedGame } from "./record";

/** Fake writer that captures all calls. */
class FakeWriter implements UserGamesWriter {
  games: { userId: string; game: OnlineGameRecord }[] = [];
  stats: { userId: string; key: string }[] = [];
  shouldThrowForUserId: string | null = null;

  async putGame(userId: string, game: OnlineGameRecord): Promise<void> {
    if (this.shouldThrowForUserId === userId) throw new Error("simulated write failure");
    this.games.push({ userId, game });
  }
  async addStat(userId: string, key: string): Promise<void> {
    if (this.shouldThrowForUserId === userId) throw new Error("simulated stat failure");
    this.stats.push({ userId, key });
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
});
