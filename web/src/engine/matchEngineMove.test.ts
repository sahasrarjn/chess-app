import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChessGame } from "./chessGame";
import { fromFEN, matchEngineMove } from "./fen";
import { resolveUciInterpretations } from "./uci";
import { engineNotation, moveUci, sq, standardNotation } from "./types";

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

describe("pawn double push", () => {
  it("allows double push only from the starting rank", () => {
    const game = new ChessGame();
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) game.board[row][col] = null;
    }
    game.board[0][9] = { kind: "K", color: "black" };
    game.board[9][0] = { kind: "K", color: "white" };
    game.board[2][4] = { kind: "P", color: "black" };
    game.activeColor = "black";

    const fromStart = matchEngineMove(game, "e8e6");
    assert.ok(fromStart);
    assert.equal(engineNotation(fromStart!.from), "e8");
    assert.equal(engineNotation(fromStart!.to), "e6");
  });

  it("rejects double push after the pawn has already advanced one square", () => {
    const game = new ChessGame();
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) game.board[row][col] = null;
    }
    game.board[0][9] = { kind: "K", color: "black" };
    game.board[9][0] = { kind: "K", color: "white" };
    game.board[3][4] = { kind: "P", color: "black" };
    game.activeColor = "black";

    assert.equal(matchEngineMove(game, "e7e5"), null);
    const single = matchEngineMove(game, "e7e6");
    assert.ok(single);
    assert.equal(engineNotation(single!.to), "e6");
  });
});

describe("matchEngineMove production acceptances", () => {
  const cases = [
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
      const game = new ChessGame();
      if ("setup" in testCase && testCase.setup) testCase.setup(game);
      const move = matchEngineMove(game, testCase.uci);
      assert.ok(move, `expected ${testCase.uci} to match a legal move`);
      assert.ok(game.applyMove(move));
    });
  }
});

describe("moveUci round-trip for border-crossing moves", () => {
  it("produces a consistently parseable UCI when moving from playable to border square", () => {
    // Rook on b6 (engine) = row 4, col 1; moves north to b10 (border) = row 0, col 1.
    const game = new ChessGame();
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) game.board[r][c] = null;
    game.board[4][1] = { kind: "R", color: "white" };
    game.board[9][0] = { kind: "K", color: "white" };
    game.board[0][9] = { kind: "K", color: "black" };

    const rookMoves = game.legalMoves("white").filter(
      (m) => m.from.row === 4 && m.from.col === 1 && m.to.row === 0 && m.to.col === 1
    );
    assert.ok(rookMoves.length > 0, "expected a legal rook move to border row 0");

    const uci = moveUci(rookMoves[0]);
    assert.equal(uci, "b6b10", "expected all-engine UCI for border move");

    const matched = matchEngineMove(game, uci);
    assert.ok(matched, `moveUci "${uci}" should round-trip through matchEngineMove`);
    assert.deepEqual(matched!.from, sq(4, 1));
    assert.deepEqual(matched!.to, sq(0, 1));
  });

  it("produces a consistently parseable UCI when moving from border to playable square", () => {
    // Rook on b10 (border) = row 0, col 1; moves south to b6 = row 4, col 1.
    const game = new ChessGame();
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) game.board[r][c] = null;
    game.board[0][1] = { kind: "R", color: "white" };
    game.board[9][0] = { kind: "K", color: "white" };
    game.board[0][9] = { kind: "K", color: "black" };

    const rookMoves = game.legalMoves("white").filter(
      (m) => m.from.row === 0 && m.from.col === 1 && m.to.row === 4 && m.to.col === 1
    );
    assert.ok(rookMoves.length > 0, "expected a legal rook move from border to playable");

    const uci = moveUci(rookMoves[0]);
    assert.equal(uci, "b10b6", "expected all-engine UCI for border move");

    const matched = matchEngineMove(game, uci);
    assert.ok(matched, `moveUci "${uci}" should round-trip through matchEngineMove`);
    assert.deepEqual(matched!.from, sq(0, 1));
    assert.deepEqual(matched!.to, sq(4, 1));
  });
});

describe("matchEngineMove illegal double pushes", () => {
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
  ];

  for (const testCase of cases) {
    it(`rejects ${testCase.name}`, () => {
      const game = fromFEN(testCase.fen);
      assert.equal(matchEngineMove(game, testCase.uci), null);
    });
  }
});
