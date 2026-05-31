import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChessGame } from "./chessGame";
import type { Move, Piece, PieceColor } from "./types";

function emptyGame(active: PieceColor): ChessGame {
  const game = new ChessGame();
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      game.board[row][col] = null;
    }
  }
  // Kings keep legality filtering realistic; tuck them out of the way.
  game.board[1][1] = { kind: "K", color: "black" };
  game.board[8][8] = { kind: "K", color: "white" };
  game.activeColor = active;
  return game;
}

function hasMove(moves: Move[], from: [number, number], to: [number, number]): boolean {
  return moves.some(
    (m) =>
      m.from.row === from[0] &&
      m.from.col === from[1] &&
      m.to.row === to[0] &&
      m.to.col === to[1]
  );
}

describe("pawn captures onto border squares", () => {
  it("lets a black pawn capture an enemy piece sitting on the right border ring", () => {
    const game = emptyGame("black");
    const pawn: Piece = { kind: "P", color: "black" };
    const rook: Piece = { kind: "R", color: "white" };
    game.board[5][8] = pawn; // rightmost playable file
    game.board[6][9] = rook; // diagonally forward, on the border (col 9)

    const moves = game.legalMoves("black");
    assert.ok(
      hasMove(moves, [5, 8], [6, 9]),
      "black pawn should be able to capture the rook on the border square"
    );
    assert.ok(game.applyMove({ from: { row: 5, col: 8 }, to: { row: 6, col: 9 } }));
    assert.equal(game.board[6][9]?.color, "black");
  });

  it("lets a white pawn capture an enemy piece sitting on the border ring (original report)", () => {
    const game = emptyGame("white");
    game.board[6][8] = { kind: "P", color: "white" };
    game.board[5][9] = { kind: "R", color: "black" }; // border col 9

    const moves = game.legalMoves("white");
    assert.ok(hasMove(moves, [6, 8], [5, 9]));
  });

  it("does not invent captures onto empty border squares", () => {
    const game = emptyGame("black");
    game.board[5][8] = { kind: "P", color: "black" };
    // No piece on (6,9): the diagonal border square stays off-limits.
    const moves = game.legalMoves("black");
    assert.ok(!hasMove(moves, [5, 8], [6, 9]));
  });
});
