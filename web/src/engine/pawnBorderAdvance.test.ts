import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChessGame } from "./chessGame";
import type { Move, PieceColor, PieceKind } from "./types";

function emptyGame(active: PieceColor): ChessGame {
  const game = new ChessGame();
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      game.board[row][col] = null;
    }
  }
  game.board[8][8] = { kind: "K", color: "white" };
  game.board[1][1] = { kind: "K", color: "black" };
  game.activeColor = active;
  return game;
}

function movesFrom(game: ChessGame, from: [number, number]): Move[] {
  return game
    .legalMoves(game.activeColor)
    .filter((m) => m.from.row === from[0] && m.from.col === from[1]);
}

function hasMove(moves: Move[], to: [number, number], promotion?: PieceKind): boolean {
  return moves.some(
    (m) => m.to.row === to[0] && m.to.col === to[1] && m.promotion === promotion
  );
}

describe("pawn advance on the border ring (parity with Fairy-Stockfish)", () => {
  it("lets a white pawn on the left border file advance straight forward", () => {
    const game = emptyGame("white");
    game.board[4][0] = { kind: "P", color: "white" }; // a-file (border), row 4
    assert.ok(
      hasMove(movesFrom(game, [4, 0]), [3, 0]),
      "white border-file pawn should advance a4->a5"
    );
  });

  it("lets a black pawn on the right border file advance straight forward", () => {
    const game = emptyGame("black");
    game.board[4][9] = { kind: "P", color: "black" }; // j-file (border)
    assert.ok(
      hasMove(movesFrom(game, [4, 9]), [5, 9]),
      "black border-file pawn should advance forward"
    );
  });

  it("lets a border-file pawn take its initial double step from the start rank", () => {
    const game = emptyGame("white");
    game.board[7][0] = { kind: "P", color: "white" }; // a3, white start rank, border file
    const moves = movesFrom(game, [7, 0]);
    assert.ok(hasMove(moves, [6, 0]), "single step a3->a4");
    assert.ok(hasMove(moves, [5, 0]), "double step a3->a5");
  });

  it("promotes a pawn that reaches a corner on the promotion rank", () => {
    const game = emptyGame("white");
    game.board[1][0] = { kind: "P", color: "white" }; // a9 -> a10 corner
    const moves = movesFrom(game, [1, 0]);
    for (const kind of ["Q", "R", "B", "N"] as PieceKind[]) {
      assert.ok(
        hasMove(moves, [0, 0], kind),
        `corner promotion a9->a10 should offer ${kind}`
      );
    }
  });

  it("does not declare stalemate when a trapped king still has a border-file pawn move", () => {
    const game = emptyGame("black");
    // Black king cornered with no king move and not in check.
    game.board[1][1] = null; // remove the helper's default black king
    game.board[0][9] = { kind: "K", color: "black" };
    game.board[2][8] = { kind: "R", color: "white" }; // covers (0,8) and (1,8)
    game.board[3][8] = { kind: "N", color: "white" }; // covers (1,9)
    game.board[8][8] = { kind: "K", color: "white" };
    // Black pawn on the border file with an empty square ahead.
    game.board[4][9] = { kind: "P", color: "black" };

    assert.equal(game.isInCheck("black"), false);
    assert.deepEqual(movesFrom(game, [0, 9]), [], "king must be trapped");
    assert.ok(
      movesFrom(game, [4, 9]).length > 0,
      "border-file pawn must have a legal advance"
    );
    assert.equal(game.result.type, "ongoing");
  });
});
