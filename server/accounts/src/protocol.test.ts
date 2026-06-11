import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseLoginRequest,
  parseUpdateMeRequest,
  validateDisplayName,
  parseGameRecordInput,
  statsKeyFor,
} from "./protocol.ts";

describe("parseLoginRequest", () => {
  it("accepts a valid google request", () => {
    const result = parseLoginRequest(JSON.stringify({ provider: "google", idToken: "tok123" }));
    assert.deepEqual(result, { provider: "google", idToken: "tok123" });
  });

  it("accepts a valid apple request", () => {
    const result = parseLoginRequest(JSON.stringify({ provider: "apple", idToken: "tok456" }));
    assert.deepEqual(result, { provider: "apple", idToken: "tok456" });
  });

  it("includes optional name when present and non-empty", () => {
    const result = parseLoginRequest(
      JSON.stringify({ provider: "google", idToken: "tok", name: "Alice" })
    );
    assert.equal(result?.name, "Alice");
  });

  it("omits name when empty or whitespace-only", () => {
    const result = parseLoginRequest(
      JSON.stringify({ provider: "google", idToken: "tok", name: "   " })
    );
    assert.equal(result?.name, undefined);
  });

  it("rejects unknown provider", () => {
    assert.equal(
      parseLoginRequest(JSON.stringify({ provider: "facebook", idToken: "tok" })),
      null
    );
  });

  it("rejects missing idToken", () => {
    assert.equal(parseLoginRequest(JSON.stringify({ provider: "google" })), null);
  });

  it("rejects empty idToken", () => {
    assert.equal(
      parseLoginRequest(JSON.stringify({ provider: "google", idToken: "" })),
      null
    );
  });

  it("rejects oversized idToken", () => {
    const big = "x".repeat(4097);
    assert.equal(
      parseLoginRequest(JSON.stringify({ provider: "google", idToken: big })),
      null
    );
  });

  it("rejects non-JSON input", () => {
    assert.equal(parseLoginRequest("not-json"), null);
  });

  it("rejects null input", () => {
    assert.equal(parseLoginRequest(null), null);
  });

  it("rejects empty string input", () => {
    assert.equal(parseLoginRequest(""), null);
  });

  it('rejects JSON array "[]"', () => {
    assert.equal(parseLoginRequest("[]"), null);
  });

  it('rejects JSON string "\\"x\\""', () => {
    assert.equal(parseLoginRequest('"x"'), null);
  });

  it('rejects JSON null "null"', () => {
    assert.equal(parseLoginRequest("null"), null);
  });

  it("treats name hint of 201 chars as absent (name is null/undefined)", () => {
    const longName = "a".repeat(201);
    const result = parseLoginRequest(
      JSON.stringify({ provider: "google", idToken: "tok", name: longName })
    );
    // Request should still parse successfully (valid provider and idToken)
    assert.ok(result !== null, "request itself should be valid");
    assert.equal(result?.name, undefined);
  });
});

describe("parseUpdateMeRequest", () => {
  it("accepts a valid displayName", () => {
    const result = parseUpdateMeRequest(JSON.stringify({ displayName: "Alice" }));
    assert.deepEqual(result, { displayName: "Alice" });
  });

  it("rejects missing displayName", () => {
    assert.equal(parseUpdateMeRequest(JSON.stringify({ foo: "bar" })), null);
  });

  it("rejects non-string displayName", () => {
    assert.equal(parseUpdateMeRequest(JSON.stringify({ displayName: 42 })), null);
  });

  it("rejects null input", () => {
    assert.equal(parseUpdateMeRequest(null), null);
  });
});

describe("parseObject 8192-byte guard", () => {
  it("rejects a body larger than 8192 bytes", () => {
    // Craft a JSON string whose length is just over 8192 bytes.
    const prefix = '{"displayName":"';
    const suffix = '"}';
    const padding = "x".repeat(8192 - prefix.length - suffix.length + 1);
    const big = prefix + padding + suffix;
    assert.ok(big.length > 8192, `sanity: body length is ${big.length}`);
    assert.equal(parseUpdateMeRequest(big), null);
  });

  it("accepts a body at exactly 8192 bytes", () => {
    const prefix = '{"displayName":"';
    const suffix = '"}';
    const padding = "x".repeat(8192 - prefix.length - suffix.length);
    const exact = prefix + padding + suffix;
    assert.equal(exact.length, 8192, `sanity: body length is ${exact.length}`);
    // The displayName value is far over 30 chars so validateDisplayName rejects it,
    // but parseUpdateMeRequest should still return a non-null object (size gate passes).
    const result = parseUpdateMeRequest(exact);
    assert.ok(result !== null, "parseUpdateMeRequest should parse a body at exactly 8192 bytes");
  });
});

describe("validateDisplayName", () => {
  it("accepts a simple name", () => {
    assert.equal(validateDisplayName("Alice"), "Alice");
  });

  it("trims leading/trailing whitespace", () => {
    assert.equal(validateDisplayName("  Alice  "), "Alice");
  });

  it("collapses internal whitespace", () => {
    assert.equal(validateDisplayName("Alice   Bob"), "Alice Bob");
  });

  it("accepts a 30-character name", () => {
    const name = "a".repeat(30);
    assert.equal(validateDisplayName(name), name);
  });

  it("rejects a 31-character name", () => {
    assert.equal(validateDisplayName("a".repeat(31)), null);
  });

  it("rejects empty string", () => {
    assert.equal(validateDisplayName(""), null);
  });

  it("rejects whitespace-only string", () => {
    assert.equal(validateDisplayName("   "), null);
  });

  it("rejects a name that trims to empty", () => {
    assert.equal(validateDisplayName("  "), null);
  });
});

// Helpers for game record tests
function validVsBot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "vsBot",
    difficulty: "medium",
    playerColor: "white",
    opponent: "Bot (Medium)",
    moves: ["e2e4", "e7e5", "d1h5"],
    resultType: "checkmate",
    winner: "white",
    endedAt: "2025-01-01T12:00:00Z",
    ...overrides,
  };
}

function validLocalTwoPlayer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "localTwoPlayer",
    difficulty: null,
    playerColor: null,
    opponent: "Player 2",
    moves: ["e2e4", "e7e5"],
    resultType: "stalemate",
    winner: null,
    endedAt: "2025-01-01T12:00:00Z",
    ...overrides,
  };
}

describe("parseGameRecordInput", () => {
  it("valid vsBot record → parsed; opponent trimmed/collapsed", () => {
    const result = parseGameRecordInput(
      JSON.stringify(validVsBot({ opponent: "  Bot   Medium  " }))
    );
    assert.ok(result !== null);
    assert.equal(result.mode, "vsBot");
    assert.equal(result.difficulty, "medium");
    assert.equal(result.playerColor, "white");
    assert.equal(result.opponent, "Bot Medium");
    assert.deepEqual(result.moves, ["e2e4", "e7e5", "d1h5"]);
    assert.equal(result.resultType, "checkmate");
    assert.equal(result.winner, "white");
  });

  it("valid localTwoPlayer record → parsed", () => {
    const result = parseGameRecordInput(JSON.stringify(validLocalTwoPlayer()));
    assert.ok(result !== null);
    assert.equal(result.mode, "localTwoPlayer");
    assert.equal(result.difficulty, null);
    assert.equal(result.playerColor, null);
    assert.equal(result.resultType, "stalemate");
    assert.equal(result.winner, null);
  });

  it('mode "online" → null (server-written only)', () => {
    assert.equal(parseGameRecordInput(JSON.stringify(validVsBot({ mode: "online" }))), null);
  });

  it("unknown mode → null", () => {
    assert.equal(parseGameRecordInput(JSON.stringify(validVsBot({ mode: "unknown" }))), null);
  });

  it("vsBot with difficulty null → null", () => {
    assert.equal(
      parseGameRecordInput(JSON.stringify(validVsBot({ difficulty: null }))),
      null
    );
  });

  it("localTwoPlayer with a difficulty → null", () => {
    assert.equal(
      parseGameRecordInput(JSON.stringify(validLocalTwoPlayer({ difficulty: "easy" }))),
      null
    );
  });

  it("vsBot with playerColor null → null", () => {
    assert.equal(
      parseGameRecordInput(JSON.stringify(validVsBot({ playerColor: null }))),
      null
    );
  });

  it("empty moves array → null", () => {
    assert.equal(parseGameRecordInput(JSON.stringify(validVsBot({ moves: [] }))), null);
  });

  it("1025 moves → null", () => {
    const moves = Array(1025).fill("e2e4");
    assert.equal(parseGameRecordInput(JSON.stringify(validVsBot({ moves }))), null);
  });

  it("a move of length 1 → null", () => {
    assert.equal(parseGameRecordInput(JSON.stringify(validVsBot({ moves: ["e"] }))), null);
  });

  it("a move of length 9 → null", () => {
    assert.equal(
      parseGameRecordInput(JSON.stringify(validVsBot({ moves: ["e2e4e2e4x"] }))),
      null
    );
  });

  it("non-string move → null", () => {
    assert.equal(parseGameRecordInput(JSON.stringify(validVsBot({ moves: [42] }))), null);
  });

  it('resultType "checkmate" with winner null → null', () => {
    assert.equal(
      parseGameRecordInput(JSON.stringify(validVsBot({ resultType: "checkmate", winner: null }))),
      null
    );
  });

  it('resultType "draw" with winner "white" → null', () => {
    assert.equal(
      parseGameRecordInput(
        JSON.stringify(validVsBot({ resultType: "draw", winner: "white" }))
      ),
      null
    );
  });

  it('resultType "stalemate" with winner → null', () => {
    assert.equal(
      parseGameRecordInput(
        JSON.stringify(validVsBot({ resultType: "stalemate", winner: "white" }))
      ),
      null
    );
  });

  it('resultType "resignation" with winner → ok', () => {
    const result = parseGameRecordInput(
      JSON.stringify(validVsBot({ resultType: "resignation", winner: "white" }))
    );
    assert.ok(result !== null);
    assert.equal(result.resultType, "resignation");
    assert.equal(result.winner, "white");
  });

  it('endedAt "not-a-date" → null', () => {
    assert.equal(
      parseGameRecordInput(JSON.stringify(validVsBot({ endedAt: "not-a-date" }))),
      null
    );
  });

  it("valid ISO endedAt is accepted", () => {
    const result = parseGameRecordInput(
      JSON.stringify(validVsBot({ endedAt: "2025-06-11T10:30:00.000Z" }))
    );
    assert.ok(result !== null);
    assert.equal(result.endedAt, "2025-06-11T10:30:00.000Z");
  });

  it("opponent empty after trim → null", () => {
    assert.equal(parseGameRecordInput(JSON.stringify(validVsBot({ opponent: "   " }))), null);
  });

  it("opponent 41 chars → null", () => {
    assert.equal(
      parseGameRecordInput(JSON.stringify(validVsBot({ opponent: "a".repeat(41) }))),
      null
    );
  });

  it("extra unknown fields (client gameId) are ignored", () => {
    const result = parseGameRecordInput(
      JSON.stringify({ ...validVsBot(), gameId: "client-id", extraField: true })
    );
    assert.ok(result !== null);
    // gameId should not be in the returned record (it has no gameId field)
    assert.equal((result as unknown as Record<string, unknown>).gameId, undefined);
  });

  it("null input → null", () => {
    assert.equal(parseGameRecordInput(null), null);
  });

  it("non-JSON input → null", () => {
    assert.equal(parseGameRecordInput("not-json"), null);
  });
});

describe("statsKeyFor", () => {
  it("vsBot medium, white wins → bot_medium_w", () => {
    assert.equal(
      statsKeyFor({ mode: "vsBot", difficulty: "medium", playerColor: "white", winner: "white" }),
      "bot_medium_w"
    );
  });

  it("vsBot medium, white loses → bot_medium_l", () => {
    assert.equal(
      statsKeyFor({ mode: "vsBot", difficulty: "medium", playerColor: "white", winner: "black" }),
      "bot_medium_l"
    );
  });

  it("vsBot medium, stalemate → bot_medium_d", () => {
    assert.equal(
      statsKeyFor({ mode: "vsBot", difficulty: "medium", playerColor: "white", winner: null }),
      "bot_medium_d"
    );
  });

  it("localTwoPlayer → null", () => {
    assert.equal(
      statsKeyFor({ mode: "localTwoPlayer", difficulty: null, playerColor: null, winner: null }),
      null
    );
  });

  it("vsBot with null playerColor → null", () => {
    assert.equal(
      statsKeyFor({ mode: "vsBot", difficulty: "easy", playerColor: null, winner: "white" }),
      null
    );
  });

  it("vsBot easy, black wins (player is black) → bot_easy_w", () => {
    assert.equal(
      statsKeyFor({ mode: "vsBot", difficulty: "easy", playerColor: "black", winner: "black" }),
      "bot_easy_w"
    );
  });

  it("vsBot hard, player is black, white wins → bot_hard_l", () => {
    assert.equal(
      statsKeyFor({ mode: "vsBot", difficulty: "hard", playerColor: "black", winner: "white" }),
      "bot_hard_l"
    );
  });
});
