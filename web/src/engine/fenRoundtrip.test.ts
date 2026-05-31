import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChessGame } from "./chessGame";
import { fromFEN, toFEN } from "./fen";

describe("FEN serialization", () => {
  it("round-trips starting position without changing legal moves", () => {
    const game = new ChessGame();
    const replay = fromFEN(toFEN(game));
    assert.equal(
      replay.legalMoves("white").length,
      game.legalMoves("white").length
    );
  });

  it("round-trips run-length ranks used in production FEN", () => {
    const runLength =
      "1R8/2nbqkb3/1pppppppp1/........../........../7n2/8P1/1PPPPPPP2/1RNBQKBN2/.......... b Q - 0 5";
    const replay = fromFEN(runLength);
    assert.equal(replay.legalMoves("black").length > 0, true);
    assert.equal(fromFEN(toFEN(replay)).legalMoves("black").length, replay.legalMoves("black").length);
  });

  it("preserves en passant square on border file", () => {
    const fen =
      "........../1rnbqkbn1r/1pppppp1p1/7p2/........../5P4/3N2N3/1PPP1PPP1/1R1BQKB1R1/.......... b KQq f4 0 3";
    const replay = fromFEN(fen);
    assert.ok(replay.enPassantTarget);
    assert.equal(toFEN(replay).split(" ")[3], "f4");
  });

  it("preserves left-border pieces through parse/serialize", () => {
    const fen =
      "R........./........../........../........../........../........../........../........../........../.......... w - - 0 1";
    const replay = fromFEN(fen);
    assert.equal(replay.board[0][0]?.kind, "R");
    assert.equal(replay.legalMoves("white").length > 0, true);
    const again = fromFEN(toFEN(replay));
    assert.equal(again.board[0][0]?.kind, "R");
  });
});
