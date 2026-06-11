import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnalyzePayload } from "./validation.ts";

// A valid 10-rank border-chess FEN (spaces between fields are mandatory in FEN notation)
const VALID_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("parseAnalyzePayload accepts a FEN with spaces between fields", () => {
  const raw = JSON.stringify({ fen: VALID_FEN, movetime_ms: 200 });
  const result = parseAnalyzePayload(raw);
  assert.ok(
    !("error" in result),
    `Expected success but got error: ${JSON.stringify(result)}`
  );
  assert.ok("fen" in result, "Expected result to have a fen field");
});

test("parseAnalyzePayload rejects a FEN with an embedded newline", () => {
  // Newline mid-FEN (not trimmed away by trim())
  const fenWithNewline =
    "rnbqkbnr/pppp\npppp/8/8/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const raw = JSON.stringify({ fen: fenWithNewline, movetime_ms: 200 });
  const result = parseAnalyzePayload(raw);
  assert.ok("error" in result, "Expected an error for FEN with newline");
  const err = (result as { error: string }).error;
  assert.equal(err, "Invalid FEN characters");
});

test("parseAnalyzePayload accepts moves-only payload without fen", () => {
  const raw = JSON.stringify({ moves: ["a1b2"], movetime_ms: 200 });
  const result = parseAnalyzePayload(raw);
  assert.ok(
    !("error" in result) || (result as { error: string }).error !== "fen or moves is required",
    "Moves-only payload should not fail with 'fen or moves is required'"
  );
});

test("parseAnalyzePayload rejects payload with neither fen nor moves", () => {
  const raw = JSON.stringify({ movetime_ms: 200 });
  const result = parseAnalyzePayload(raw);
  assert.ok("error" in result);
  assert.equal((result as { error: string }).error, "fen or moves is required");
});
