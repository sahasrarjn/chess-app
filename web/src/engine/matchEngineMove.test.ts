import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChessGame } from "./chessGame";
import { fromFEN, matchEngineMove } from "./fen";
import { resolveUciInterpretations } from "./uci";
import { engineNotation, standardNotation } from "./types";

describe("resolveUciInterpretations", () => {
  it("includes both engine and standard mappings for inner-board squares", () => {
    const options = resolveUciInterpretations("d7d5");
    assert.ok(options.length >= 2);
    const engineFrom = options.find(
      (o) => engineNotation(o.from) === "d7" && engineNotation(o.to) === "d5"
    );
    const standardFrom = options.find(
      (o) => standardNotation(o.from) === "d7" && standardNotation(o.to) === "d5"
    );
    assert.ok(engineFrom, "expected engine-grid d7d5");
    assert.ok(standardFrom, "expected standard-grid d7d5");
    assert.notDeepEqual(engineFrom, standardFrom);
  });
});

describe("pawn double push from engine rank 7", () => {
  it("allows black d7d5 after one-step advance (Fairy-Stockfish parity)", () => {
    const game = new ChessGame();
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) game.board[row][col] = null;
    }
    game.board[1][1] = { kind: "K", color: "black" };
    game.board[8][8] = { kind: "K", color: "white" };
    game.board[3][3] = { kind: "P", color: "black" };
    game.activeColor = "black";

    const move = matchEngineMove(game, "d7d5");
    assert.ok(move);
    assert.equal(engineNotation(move.from), "d7");
    assert.equal(engineNotation(move.to), "d5");
  });
});

describe("matchEngineMove production rejections", () => {
  const cases = [
    {
      name: "d7d5 midgame (PostHog 2026-05-31)",
      fen: "........../1rn2kb2r/2p3pp2/1p1p1p2p1/........../q3PP4/2B1N1N1P1/1PPP2PP1b/4QK3R/9R b q - 5 14",
      uci: "d7d5",
    },
    {
      name: "e7e5 midgame",
      fen: "4r5/3b1k1n2/1pp2bpp2/1n1ppp2p1/1P4q3/1R1N2P3/4PP4/2PP3PP1/2NBQKB2r/6R3 b - - 5 16",
      uci: "e7e5",
    },
    {
      name: "h9g7 opening knight (engine notation)",
      setup: (game: ChessGame) => {
        const whiteOpens = matchEngineMove(game, "f2f4");
        assert.ok(whiteOpens && game.applyMove(whiteOpens));
      },
      uci: "h9g7",
    },
  ];

  for (const testCase of cases) {
    it(`accepts server UCI for ${testCase.name}`, () => {
      const game =
        "fen" in testCase && testCase.fen ? fromFEN(testCase.fen) : new ChessGame();
      if ("setup" in testCase && testCase.setup) testCase.setup(game);
      const move = matchEngineMove(game, testCase.uci);
      assert.ok(move, `expected ${testCase.uci} to match a legal move`);
      assert.ok(game.applyMove(move));
    });
  }
});
