import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyMove,
  toWhiteRelative,
  MATE_CP,
  type MoveClassification,
  type PositionEval,
} from "./classify";
import { FIXTURES } from "./testFixtures";

function cp(n: number): PositionEval {
  return { cp: n, mateIn: null };
}

function mate(n: number): PositionEval {
  return { cp: null, mateIn: n };
}

describe("classifyMove — threshold table (white mover)", () => {
  const table: [string, PositionEval, PositionEval, MoveClassification][] = [
    ["swing 0 → ok", cp(100), cp(100), "ok"],
    ["swing 49 → ok", cp(100), cp(51), "ok"],
    ["swing 50 → inaccuracy", cp(100), cp(50), "inaccuracy"],
    ["swing 149 → inaccuracy", cp(200), cp(51), "inaccuracy"],
    ["swing 150 → mistake", cp(200), cp(50), "mistake"],
    ["swing 299 → mistake", cp(300), cp(1), "mistake"],
    ["swing 300 → blunder", cp(300), cp(0), "blunder"],
    ["swing 900 → blunder", cp(900), cp(0), "blunder"],
  ];

  for (const [name, before, after, expected] of table) {
    it(name, () => {
      assert.equal(classifyMove(before, after, "white"), expected);
    });
  }
});

describe("classifyMove — threshold table (black mover, White-relative evals)", () => {
  // Same swings expressed from Black's perspective: when mover is black,
  // a White-relative drop of e.g. cp -100 → cp -50 is a +50 swing for black.
  const table: [string, PositionEval, PositionEval, MoveClassification][] = [
    ["swing 0 → ok", cp(-100), cp(-100), "ok"],
    ["swing 49 → ok", cp(-100), cp(-51), "ok"],
    ["swing 50 → inaccuracy", cp(-100), cp(-50), "inaccuracy"],
    ["swing 150 → mistake", cp(-200), cp(-50), "mistake"],
    ["swing 300 → blunder", cp(-300), cp(0), "blunder"],
  ];

  for (const [name, before, after, expected] of table) {
    it(name + " (black)", () => {
      assert.equal(classifyMove(before, after, "black"), expected);
    });
  }
});

describe("classifyMove — improvement floors at ok", () => {
  it("eval improvement (mover gains) → ok (swing floors at 0)", () => {
    assert.equal(classifyMove(cp(50), cp(200), "white"), "ok");
  });

  it("eval improvement for black → ok", () => {
    // Position goes from cp -200 to cp -50 (White-relative): when it is Black's move,
    // this means White's eval went UP (better for White), so it was a good move for Black's opponent.
    // But here we test when BLACK made the move: before=-50, after=-200 means White got worse,
    // so from Black's mover perspective moverBefore=+50, moverAfter=+200 → improvement → ok.
    assert.equal(classifyMove(cp(-50), cp(-200), "black"), "ok");
  });
});

describe("classifyMove — clamping", () => {
  it("cp +2500 → +600 (white): both clamped to 1500 and 600, swing 900 → blunder", () => {
    assert.equal(classifyMove(cp(+2500), cp(+600), "white"), "blunder");
  });

  it("cp +5000 → +2000 (white): both clamp to +1500 → swing 0 → ok (winning is winning)", () => {
    assert.equal(classifyMove(cp(+5000), cp(+2000), "white"), "ok");
  });

  it("cp -2500 → -600 (black): symmetric clamping, swing 900 → blunder", () => {
    assert.equal(classifyMove(cp(-2500), cp(-600), "black"), "blunder");
  });
});

describe("classifyMove — mate rules", () => {
  it("mateIn +1 → cp +900 (white): missed mate, still winning ≥ +300 → mistake", () => {
    assert.equal(classifyMove(mate(+1), cp(+900), "white"), "mistake");
  });

  it("mateIn +1 → cp +100 (white): missed mate, winning < +300 → blunder", () => {
    assert.equal(classifyMove(mate(+1), cp(+100), "white"), "blunder");
  });

  it("cp -80 → mateIn -2 (white): walked into forced mate, position was not lost → blunder", () => {
    assert.equal(classifyMove(cp(-80), mate(-2), "white"), "blunder");
  });

  it("cp -700 → mateIn -3 (white): walked into mate when already lost (< -300) → ok", () => {
    assert.equal(classifyMove(cp(-700), mate(-3), "white"), "ok");
  });

  it("mateIn +3 → mateIn +5 (white): mate drift while still mating → ok", () => {
    assert.equal(classifyMove(mate(+3), mate(+5), "white"), "ok");
  });

  it("mateIn -2 → mateIn -1 (white): already being mated, getting closer → ok", () => {
    assert.equal(classifyMove(mate(-2), mate(-1), "white"), "ok");
  });
});

describe("toWhiteRelative", () => {
  it("side-to-move cp positive (black): negated for White-relative", () => {
    const result = toWhiteRelative(120, null, "black");
    assert.deepEqual(result, { cp: -120, mateIn: null });
  });

  it("side-to-move mate positive (black): negated for White-relative", () => {
    const result = toWhiteRelative(null, 2, "black");
    assert.deepEqual(result, { cp: null, mateIn: -2 });
  });

  it("mate 0 for white (already mated): maps to cp -MATE_CP", () => {
    const result = toWhiteRelative(null, 0, "white");
    assert.deepEqual(result, { cp: -MATE_CP, mateIn: null });
  });

  it("mate 0 for black (already mated): maps to cp +MATE_CP", () => {
    const result = toWhiteRelative(null, 0, "black");
    assert.deepEqual(result, { cp: +MATE_CP, mateIn: null });
  });

  it("side-to-move cp positive (white): unchanged for White-relative", () => {
    const result = toWhiteRelative(80, null, "white");
    assert.deepEqual(result, { cp: 80, mateIn: null });
  });

  it("side-to-move mate positive (white): unchanged for White-relative", () => {
    const result = toWhiteRelative(null, 3, "white");
    assert.deepEqual(result, { cp: null, mateIn: 3 });
  });
});

describe("classifyMove — all shared fixtures", () => {
  for (const f of FIXTURES) {
    it(`${f.name}: classifyMove(before, after, mover) === "${f.expectedClassification}"`, () => {
      const result = classifyMove(f.before, f.after, f.mover);
      assert.equal(
        result,
        f.expectedClassification,
        `Expected ${f.expectedClassification} but got ${result} for fixture ${f.name}`
      );
    });
  }
});
