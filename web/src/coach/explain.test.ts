import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fromFEN, matchEngineMove } from "../engine/fen";
import { FIXTURES } from "./testFixtures";
import { explainMove, hintWhy, type ExplainInput } from "./explain";
import type { PositionEval } from "./classify";

function cp(n: number): PositionEval {
  return { cp: n, mateIn: null };
}

function mate(n: number): PositionEval {
  return { cp: null, mateIn: n };
}

describe("explain.test — fixture FEN legality", () => {
  for (const f of FIXTURES) {
    it(`${f.name}: FEN parses and both moves are legal`, () => {
      const game = fromFEN(f.fen);
      assert.ok(game, "fromFEN should parse the FEN");
      const played = matchEngineMove(game, f.movePlayed);
      assert.ok(played, `movePlayed "${f.movePlayed}" should be legal in ${f.name}`);
      const best = matchEngineMove(game, f.bestMoveUci);
      assert.ok(best, `bestMoveUci "${f.bestMoveUci}" should be legal in ${f.name}`);
    });
  }
});

describe("explainMove — category selection via stable substrings", () => {
  it("HUNG_QUEEN: matches 'hanging'", () => {
    const f = FIXTURES.find((x) => x.name === "HUNG_QUEEN")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: f.bestMoveUci,
      pv: f.pv,
      before: f.before,
      after: f.after,
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    assert.match(text, /hanging/i);
  });

  it("MISSED_CAPTURE_QUEEN: matches 'winning the queen'", () => {
    const f = FIXTURES.find((x) => x.name === "MISSED_CAPTURE_QUEEN")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: f.bestMoveUci,
      pv: f.pv,
      before: f.before,
      after: f.after,
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    assert.match(text, /winning the queen/i);
  });

  it("MISSED_MATE_1: matches 'mate in 1'", () => {
    const f = FIXTURES.find((x) => x.name === "MISSED_MATE_1")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: f.bestMoveUci,
      pv: f.pv,
      before: f.before,
      after: f.after,
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    assert.match(text, /mate in 1/i);
  });

  it("WALKED_INTO_MATE_1: matches 'allows mate'", () => {
    const f = FIXTURES.find((x) => x.name === "WALKED_INTO_MATE_1")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: f.bestMoveUci,
      pv: f.pv,
      before: f.before,
      after: f.after,
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    assert.match(text, /allows mate in 2/i);
  });

  it("GENERIC_1: matches 'engine preferred'", () => {
    const f = FIXTURES.find((x) => x.name === "GENERIC_1")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: f.bestMoveUci,
      pv: f.pv,
      before: f.before,
      after: f.after,
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    assert.match(text, /engine preferred/i);
  });
});

describe("explainMove — exact template strings", () => {
  it("#1 HUNG_QUEEN: exact string", () => {
    const f = FIXTURES.find((x) => x.name === "HUNG_QUEEN")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: f.bestMoveUci,
      pv: f.pv,
      before: f.before,
      after: f.after,
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    assert.equal(text, "Your queen on d5 is hanging — it can simply be taken.");
  });

  it("#3 MISSED_CAPTURE_QUEEN: exact string", () => {
    const f = FIXTURES.find((x) => x.name === "MISSED_CAPTURE_QUEEN")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: f.bestMoveUci,
      pv: f.pv,
      before: f.before,
      after: f.after,
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    assert.equal(text, "You missed d1d5, winning the queen on d5.");
  });

  it("#5 MISSED_MATE_1: exact string", () => {
    const f = FIXTURES.find((x) => x.name === "MISSED_MATE_1")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: f.bestMoveUci,
      pv: f.pv,
      before: f.before,
      after: f.after,
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    assert.equal(text, "You had mate in 1, starting with g1g8.");
  });

  it("#7 WALKED_INTO_MATE_1: exact string", () => {
    const f = FIXTURES.find((x) => x.name === "WALKED_INTO_MATE_1")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: f.bestMoveUci,
      pv: f.pv,
      before: f.before,
      after: f.after,
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    assert.equal(text, "This allows mate in 2.");
  });

  it("#9 GENERIC_1: exact string", () => {
    const f = FIXTURES.find((x) => x.name === "GENERIC_1")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: f.bestMoveUci,
      pv: f.pv,
      before: f.before,
      after: f.after,
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    assert.equal(text, "This loses ground — the engine preferred e2e4.");
  });
});

describe("explainMove — priority: walked-into-mate wins over hung piece", () => {
  it("WALKED_INTO_MATE_1 board with after mateIn:-2 and moved-piece attacked → mate template wins", () => {
    // Use WALKED_INTO_MATE_1 fixture which already has after=mateIn:-2
    // The played move h2h3 may or may not land on an attacked square, but
    // walked-into-mate should be reported first regardless.
    const f = FIXTURES.find((x) => x.name === "WALKED_INTO_MATE_1")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: f.bestMoveUci,
      pv: f.pv,
      before: f.before,
      after: f.after, // mate(-2) → walked-into-mate
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    // Must start with "This allows mate" not "hanging"
    assert.match(text, /^This allows mate/);
  });
});

describe("explainMove — no best move available", () => {
  it("bestMoveUci null → generic fallback without 'preferred' suffix", () => {
    const f = FIXTURES.find((x) => x.name === "GENERIC_1")!;
    const input: ExplainInput = {
      fen: f.fen,
      movePlayed: f.movePlayed,
      bestMoveUci: null,
      pv: [],
      before: f.before,
      after: f.after,
      classification: f.expectedClassification,
      mover: f.mover,
    };
    const text = explainMove(input);
    assert.equal(text, "This loses ground.");
  });
});

describe("hintWhy", () => {
  it("cached eval with mateIn:+2 (white to move) → 'Mates in 2.'", () => {
    const f = FIXTURES.find((x) => x.name === "MISSED_MATE_2")!;
    const result = hintWhy(f.fen, f.bestMoveUci, mate(+2), "white");
    assert.equal(result, "Mates in 2.");
  });

  it("best move is a capture (fixture #3, d1d5) → 'Wins the queen on d5.'", () => {
    const f = FIXTURES.find((x) => x.name === "MISSED_CAPTURE_QUEEN")!;
    const result = hintWhy(f.fen, f.bestMoveUci, cp(+500), "white");
    assert.equal(result, "Wins the queen on d5.");
  });

  it("best move gives check (fixture #1, d1h5) → 'Forcing check.'", () => {
    const f = FIXTURES.find((x) => x.name === "HUNG_QUEEN")!;
    // d1h5 puts the black king in check
    const result = hintWhy(f.fen, f.bestMoveUci, cp(+50), "white");
    assert.equal(result, "Forcing check.");
  });

  it("eval cp:+120 with no capture/check → 'Engine\\'s top move (+1.2).'", () => {
    const f = FIXTURES.find((x) => x.name === "HUNG_KNIGHT")!;
    // g1h3 is a quiet knight move
    const result = hintWhy(f.fen, f.bestMoveUci, cp(+120), "white");
    assert.equal(result, "Engine's top move (+1.2).");
  });

  it("black to move with White-relative cp:-90 → 'Engine\\'s top move (+0.9).' (mover perspective)", () => {
    const f = FIXTURES.find((x) => x.name === "GENERIC_2")!;
    // Black to move; White-relative -90 means Black is +90 (their perspective)
    const result = hintWhy(f.fen, f.bestMoveUci, cp(-90), "black");
    assert.equal(result, "Engine's top move (+0.9).");
  });

  it("evalAtPosition null → null", () => {
    const f = FIXTURES.find((x) => x.name === "GENERIC_1")!;
    const result = hintWhy(f.fen, f.bestMoveUci, null, "white");
    assert.equal(result, null);
  });
});
