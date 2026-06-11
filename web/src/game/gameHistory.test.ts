import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendGameToHistory,
  completedGameRecord,
  loadGameHistory,
  resultLabel,
  GAME_HISTORY_KEY,
  MAX_HISTORY_GAMES,
  type CompletedGameRecord,
} from "./gameHistory";
import { ChessGame } from "../engine/chessGame";
import { matchEngineMove } from "../engine/fen";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function sampleRecord(overrides: Partial<CompletedGameRecord> = {}): CompletedGameRecord {
  return {
    gameId: "game-001",
    mode: "vsBot",
    difficulty: "medium",
    playerColor: "white",
    opponent: "Bot (medium)",
    moves: ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"],
    resultType: "checkmate",
    winner: "white",
    endedAt: "2024-01-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("loadGameHistory", () => {
  it("returns [] for empty storage", () => {
    const storage = fakeStorage();
    assert.deepEqual(loadGameHistory(storage), []);
  });

  it("returns [] for missing key", () => {
    const storage = fakeStorage({ other: "data" });
    assert.deepEqual(loadGameHistory(storage), []);
  });

  it("returns [] for corrupt JSON", () => {
    const storage = fakeStorage({ [GAME_HISTORY_KEY]: "{{not-valid" });
    assert.deepEqual(loadGameHistory(storage), []);
  });

  it("returns [] for wrong version", () => {
    const storage = fakeStorage({
      [GAME_HISTORY_KEY]: JSON.stringify({ version: 99, games: [] }),
    });
    assert.deepEqual(loadGameHistory(storage), []);
  });

  it("returns [] when games is not an array", () => {
    const storage = fakeStorage({
      [GAME_HISTORY_KEY]: JSON.stringify({ version: 1, games: "nope" }),
    });
    assert.deepEqual(loadGameHistory(storage), []);
  });
});

describe("appendGameToHistory + loadGameHistory round-trip", () => {
  it("round-trips a record: append then load returns it newest-first", () => {
    const storage = fakeStorage();
    const r = sampleRecord();
    const stored = appendGameToHistory(r, storage);
    assert.equal(stored, true);
    const loaded = loadGameHistory(storage);
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], r);
  });

  it("prepends new records so newest is first", () => {
    const storage = fakeStorage();
    const r1 = sampleRecord({ gameId: "g1", endedAt: "2024-01-01T10:00:00.000Z", moves: ["e2e4", "e7e5"] });
    const r2 = sampleRecord({ gameId: "g2", endedAt: "2024-01-01T11:00:00.000Z", moves: ["d2d4", "d7d5"] });
    appendGameToHistory(r1, storage);
    appendGameToHistory(r2, storage);
    const loaded = loadGameHistory(storage);
    assert.equal(loaded[0].gameId, "g2");
    assert.equal(loaded[1].gameId, "g1");
  });

  it("caps at MAX_HISTORY_GAMES (25): 26 appends keeps only 25, oldest dropped", () => {
    const storage = fakeStorage();
    for (let i = 0; i < MAX_HISTORY_GAMES + 1; i++) {
      appendGameToHistory(
        sampleRecord({ gameId: `g${i}`, moves: [`e2e${3 + i}`, "e7e5"], endedAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
        storage
      );
    }
    const loaded = loadGameHistory(storage);
    assert.equal(loaded.length, MAX_HISTORY_GAMES);
    // Oldest (g0) should be dropped; g1 should be the last
    assert.ok(!loaded.some((g) => g.gameId === "g0"), "oldest entry should be dropped");
    assert.ok(loaded.some((g) => g.gameId === `g${MAX_HISTORY_GAMES}`), "newest should be kept");
  });

  it("corrupt JSON in storage → loadGameHistory returns []; next append rewrites cleanly", () => {
    const storage = fakeStorage({ [GAME_HISTORY_KEY]: "not-json!!!" });
    assert.deepEqual(loadGameHistory(storage), []);
    const r = sampleRecord();
    appendGameToHistory(r, storage);
    const loaded = loadGameHistory(storage);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].gameId, r.gameId);
  });
});

describe("appendGameToHistory deduplication", () => {
  it("returns false and does not re-store a duplicate (same mode+moves+resultType)", () => {
    const storage = fakeStorage();
    const r1 = sampleRecord({ gameId: "g1", endedAt: "2024-01-01T10:00:00.000Z" });
    // Different gameId and endedAt but same mode/moves/resultType
    const r2 = sampleRecord({ gameId: "g2", endedAt: "2024-01-02T11:00:00.000Z" });
    assert.equal(appendGameToHistory(r1, storage), true);
    assert.equal(appendGameToHistory(r2, storage), false);
    assert.equal(loadGameHistory(storage).length, 1);
  });

  it("allows a different resultType with same moves", () => {
    const storage = fakeStorage();
    const r1 = sampleRecord({ gameId: "g1", resultType: "checkmate", moves: ["e2e4", "e7e5"] });
    const r2 = sampleRecord({ gameId: "g2", resultType: "resignation", moves: ["e2e4", "e7e5"] });
    assert.equal(appendGameToHistory(r1, storage), true);
    assert.equal(appendGameToHistory(r2, storage), true);
    assert.equal(loadGameHistory(storage).length, 2);
  });

  it("allows different moves with same resultType", () => {
    const storage = fakeStorage();
    const r1 = sampleRecord({ gameId: "g1", moves: ["e2e4", "e7e5"], resultType: "checkmate" });
    const r2 = sampleRecord({ gameId: "g2", moves: ["d2d4", "d7d5"], resultType: "checkmate" });
    assert.equal(appendGameToHistory(r1, storage), true);
    assert.equal(appendGameToHistory(r2, storage), true);
    assert.equal(loadGameHistory(storage).length, 2);
  });
});

describe("completedGameRecord", () => {
  it("returns null for an ongoing game", () => {
    const game = new ChessGame();
    const result = completedGameRecord({
      game,
      mode: "vsBot",
      difficulty: "medium",
      playerColor: "white",
      opponent: "Bot (medium)",
    });
    assert.equal(result, null);
  });

  it("builds a record from a resigned game", () => {
    const game = new ChessGame();
    game.resign("black");
    const record = completedGameRecord({
      game,
      mode: "vsBot",
      difficulty: "easy",
      playerColor: "white",
      opponent: "Bot (easy)",
      endedAt: "2024-06-01T00:00:00.000Z",
    });
    assert.ok(record !== null);
    assert.equal(record.mode, "vsBot");
    assert.equal(record.difficulty, "easy");
    assert.equal(record.playerColor, "white");
    assert.equal(record.opponent, "Bot (easy)");
    assert.equal(record.resultType, "resignation");
    assert.equal(record.winner, "white");
    assert.equal(record.moves.length, 0);
    assert.equal(record.endedAt, "2024-06-01T00:00:00.000Z");
    assert.ok(typeof record.gameId === "string" && record.gameId.length > 0);
  });

  it("captures moves as UCI strings from a game with moves", () => {
    const game = new ChessGame();
    // Make a couple moves
    const m1 = matchEngineMove(game, "e2e4");
    assert.ok(m1);
    game.applyMove(m1!);
    const m2 = matchEngineMove(game, "e7e5");
    assert.ok(m2);
    game.applyMove(m2!);
    game.resign("black");

    const record = completedGameRecord({
      game,
      mode: "vsBot",
      difficulty: "medium",
      playerColor: "white",
      opponent: "Bot (medium)",
    });
    assert.ok(record !== null);
    assert.equal(record.moves.length, 2);
    assert.equal(record.resultType, "resignation");
    assert.equal(record.winner, "white");
  });

  it("uses provided endedAt when given", () => {
    const game = new ChessGame();
    game.resign("white");
    const record = completedGameRecord({
      game,
      mode: "vsBot",
      difficulty: "hard",
      playerColor: "white",
      opponent: "Bot (hard)",
      endedAt: "2025-01-15T08:30:00.000Z",
    });
    assert.ok(record !== null);
    assert.equal(record.endedAt, "2025-01-15T08:30:00.000Z");
  });

  it("sets endedAt automatically when not provided", () => {
    const game = new ChessGame();
    game.resign("white");
    const before = Date.now();
    const record = completedGameRecord({
      game,
      mode: "vsBot",
      difficulty: "medium",
      playerColor: "white",
      opponent: "Bot (medium)",
    });
    const after = Date.now();
    assert.ok(record !== null);
    const ts = new Date(record.endedAt).getTime();
    assert.ok(ts >= before && ts <= after);
  });
});

describe("completedGameRecord — fallbackResult", () => {
  it("uses fallbackResult when the game is ongoing (e.g. server-resigned with 0 moves)", () => {
    const game = new ChessGame(); // still ongoing — no moves, no resign
    const record = completedGameRecord({
      game,
      mode: "online",
      difficulty: null,
      playerColor: "white",
      opponent: "Bob",
      fallbackResult: { type: "resignation", winner: "black" },
    });
    assert.ok(record !== null, "should return a record when fallbackResult provided");
    assert.equal(record!.resultType, "resignation");
    assert.equal(record!.winner, "black");
  });

  it("ignores fallbackResult when game already has a real result", () => {
    const game = new ChessGame();
    game.resign("white"); // black wins
    const record = completedGameRecord({
      game,
      mode: "online",
      difficulty: null,
      playerColor: "white",
      opponent: "Bob",
      fallbackResult: { type: "resignation", winner: "white" }, // contradicts real result
    });
    assert.ok(record !== null);
    assert.equal(record!.winner, "black", "real game result should take precedence");
  });
});

describe("resultLabel", () => {
  it("vsBot win → W/win", () => {
    const r = sampleRecord({ playerColor: "white", winner: "white", resultType: "checkmate" });
    assert.deepEqual(resultLabel(r), { text: "W", kind: "win" });
  });

  it("vsBot loss → L/loss", () => {
    const r = sampleRecord({ playerColor: "white", winner: "black", resultType: "checkmate" });
    assert.deepEqual(resultLabel(r), { text: "L", kind: "loss" });
  });

  it("draw → D/draw", () => {
    const r = sampleRecord({ playerColor: "white", winner: null, resultType: "draw" });
    assert.deepEqual(resultLabel(r), { text: "D", kind: "draw" });
  });

  it("stalemate → D/draw", () => {
    const r = sampleRecord({ playerColor: "white", winner: null, resultType: "stalemate" });
    assert.deepEqual(resultLabel(r), { text: "D", kind: "draw" });
  });

  it("localTwoPlayer white wins → 1–0/neutral", () => {
    const r = sampleRecord({
      mode: "localTwoPlayer",
      playerColor: null,
      winner: "white",
      resultType: "checkmate",
    });
    assert.deepEqual(resultLabel(r), { text: "1–0", kind: "neutral" });
  });

  it("localTwoPlayer black wins → 0–1/neutral", () => {
    const r = sampleRecord({
      mode: "localTwoPlayer",
      playerColor: null,
      winner: "black",
      resultType: "checkmate",
    });
    assert.deepEqual(resultLabel(r), { text: "0–1", kind: "neutral" });
  });

  it("localTwoPlayer draw → ½/neutral", () => {
    const r = sampleRecord({
      mode: "localTwoPlayer",
      playerColor: null,
      winner: null,
      resultType: "stalemate",
    });
    assert.deepEqual(resultLabel(r), { text: "½", kind: "neutral" });
  });

  it("online with playerColor tracks perspective", () => {
    const w = sampleRecord({ mode: "online", playerColor: "white", winner: "white", resultType: "checkmate" });
    assert.deepEqual(resultLabel(w), { text: "W", kind: "win" });
    const l = sampleRecord({ mode: "online", playerColor: "white", winner: "black", resultType: "checkmate" });
    assert.deepEqual(resultLabel(l), { text: "L", kind: "loss" });
    const d = sampleRecord({ mode: "online", playerColor: "black", winner: null, resultType: "stalemate" });
    assert.deepEqual(resultLabel(d), { text: "D", kind: "draw" });
  });
});
