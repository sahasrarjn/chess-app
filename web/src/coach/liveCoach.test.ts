import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromFEN, matchEngineMove } from "../engine/fen";
import { moveUci } from "../engine/types";
import { FIXTURES, START_FEN } from "./testFixtures";
import type { EngineAnalysis, AnalyzeFn } from "./analyzeClient";
import type { PositionEval } from "./classify";
import { LiveCoach } from "./liveCoach";

// Helper: make a simple scripted analyze function
function makeAnalyzeFn(responses: Array<EngineAnalysis | null>): {
  fn: AnalyzeFn;
  calls: number;
} {
  let idx = 0;
  let calls = 0;
  const fn: AnalyzeFn = async (_game, _movetime, signal) => {
    calls++;
    const resp = responses[idx++];
    if (resp === null) {
      // simulate rejection
      throw new Error("analyze failure");
    }
    // Simulate async
    await new Promise<void>((res) => setTimeout(res, 1));
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    return resp;
  };
  return { fn, calls: 0 };
}

function makeAnalyzeFnWithControl(): {
  fn: AnalyzeFn;
  resolve: (result: EngineAnalysis) => void;
  reject: (err: Error) => void;
} {
  let _resolve: ((r: EngineAnalysis) => void) | null = null;
  let _reject: ((e: Error) => void) | null = null;
  const fn: AnalyzeFn = (_game, _movetime, _signal) => {
    return new Promise<EngineAnalysis>((res, rej) => {
      _resolve = res;
      _reject = rej;
    });
  };
  return {
    fn,
    get resolve() { return _resolve!; },
    get reject() { return _reject!; },
  };
}

const WHITE_CP_100: EngineAnalysis = {
  scoreCp: 100,
  mateIn: null,
  bestMoveUci: "e2e4",
  pv: ["e2e4"],
  source: "server",
};

const BLUNDER_RESULT: EngineAnalysis = {
  scoreCp: -850,
  mateIn: null,
  bestMoveUci: "d1h5",
  pv: ["d1h5"],
  source: "server",
};

describe("LiveCoach", () => {
  it("disabled: onPositionChanged never calls analyze", async () => {
    let analyzeCalled = false;
    const analyzeFn: AnalyzeFn = async () => {
      analyzeCalled = true;
      return WHITE_CP_100;
    };

    const coach = new LiveCoach(() => {}, analyzeFn);
    coach.enabled = false;

    const game = fromFEN(START_FEN);
    coach.onPositionChanged(game, 0, null, null, null, false);

    // Give microtasks a chance to run
    await new Promise<void>((res) => setTimeout(res, 10));
    assert.equal(analyzeCalled, false, "analyze should not be called when disabled");
  });

  it("first position (ply 0) analyzed: evalForPly(0) set White-relative", async () => {
    let updated = false;
    const onUpdate = (): void => { updated = true; };

    // black-to-move position (START_FEN is white to move, use score from black perspective)
    const analyzeFn: AnalyzeFn = async (game) => {
      // return score from side-to-move perspective (white: score 50 = +50 white-relative)
      return {
        scoreCp: 50,
        mateIn: null,
        bestMoveUci: "e2e4",
        pv: ["e2e4"],
        source: "server",
      };
    };

    const coach = new LiveCoach(onUpdate, analyzeFn);
    coach.enabled = true;

    const game = fromFEN(START_FEN); // white to move
    coach.onPositionChanged(game, 0, null, null, null, false);

    // Wait for analysis to complete
    await new Promise<void>((res) => setTimeout(res, 50));
    assert.ok(updated, "onUpdate should have been called");

    const eval0 = coach.evalForPly(0);
    assert.ok(eval0 != null, "eval for ply 0 should be set");
    // White-relative: white to move with score 50 → +50
    assert.equal(eval0.cp, 50);
  });

  it("black-to-move position: cp negated for White-relative", async () => {
    // Build FEN with black to move
    const blackToMoveFEN = START_FEN.replace(" w ", " b ");
    const analyzeFn: AnalyzeFn = async () => ({
      scoreCp: 50, // from black's perspective
      mateIn: null,
      bestMoveUci: "e7e5",
      pv: ["e7e5"],
      source: "server",
    });

    const coach = new LiveCoach(() => {}, analyzeFn);
    coach.enabled = true;
    const game = fromFEN(blackToMoveFEN);
    coach.onPositionChanged(game, 1, null, null, null, false);
    await new Promise<void>((res) => setTimeout(res, 50));

    const eval1 = coach.evalForPly(1);
    assert.ok(eval1 != null);
    // black side-to-move 50 → white-relative: -50
    assert.equal(eval1.cp, -50);
  });

  it("blunder-sized drop: banner set with classification blunder and text containing 'hanging'", async () => {
    const f = FIXTURES[0]; // HUNG_QUEEN

    // First analyze ply 0 with before-eval (f.before = cp +50)
    let callCount = 0;
    const analyzeFn: AnalyzeFn = async (game) => {
      callCount++;
      if (callCount === 1) {
        // ply 0 position analysis: return +50 from white perspective
        return {
          scoreCp: 50, // white to move → white-relative +50
          mateIn: null,
          bestMoveUci: f.bestMoveUci,
          pv: f.pv,
          source: "server",
        };
      }
      // ply 1 analysis: after the blunder, return -850 white-relative
      // (white still to move? Actually after white's move, black is to move)
      // after is {cp:-850} white-relative. Black to move → scoreCp = +850 from black perspective
      return {
        scoreCp: 850, // from black's perspective → white-relative = -850
        mateIn: null,
        bestMoveUci: null,
        pv: [],
        source: "server",
      };
    };

    const coach = new LiveCoach(() => {}, analyzeFn);
    coach.enabled = true;

    const game0 = fromFEN(f.fen);
    coach.onPositionChanged(game0, 0, null, null, "white", false);
    await new Promise<void>((res) => setTimeout(res, 50));

    // Now make white's blunder move d1d5
    const moveObj = matchEngineMove(game0, f.movePlayed);
    assert.ok(moveObj, `move ${f.movePlayed} should be legal in fixture`);

    const game1 = fromFEN(f.fen);
    game1.applyMoveUnchecked(moveObj!, false);
    // After white's move, black is to move → mover was white
    coach.onPositionChanged(game1, 1, moveObj, f.fen, "white", true);
    await new Promise<void>((res) => setTimeout(res, 50));

    const banner = coach.banner;
    assert.ok(banner != null, "banner should be set after blunder");
    assert.equal(banner?.classification, "blunder");
    assert.ok(banner?.text.toLowerCase().includes("hanging"), `banner text should contain 'hanging', got: ${banner?.text}`);
  });

  it("latest-wins: ply 1 resolving after ply 2 is discarded", async () => {
    // Create two manually-controlled analyze promises
    let resolve1: ((r: EngineAnalysis) => void) | null = null;
    let reject1: ((e: Error) => void) | null = null;
    let resolve2: ((r: EngineAnalysis) => void) | null = null;
    let callCount = 0;
    let abortedCount = 0;

    const analyzeFn: AnalyzeFn = async (_game, _movetime, signal) => {
      callCount++;
      const n = callCount;
      return new Promise<EngineAnalysis>((res, rej) => {
        if (n === 1) { resolve1 = res; reject1 = rej; }
        else { resolve2 = res; }
        signal?.addEventListener("abort", () => {
          abortedCount++;
          rej(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    };

    let updateCount = 0;
    const coach = new LiveCoach(() => { updateCount++; }, analyzeFn);
    coach.enabled = true;

    const game = fromFEN(START_FEN);

    // Trigger ply 0 analysis (becomes ply 1 trigger)
    coach.onPositionChanged(game, 0, null, null, null, false);
    // Before ply 0 resolves, trigger ply 1
    coach.onPositionChanged(game, 1, null, null, null, false);

    // Ply 0's in-flight should have been aborted
    assert.equal(abortedCount, 1, "first in-flight should be aborted");

    // Now resolve ply 2's analysis
    resolve2!({
      scoreCp: 200,
      mateIn: null,
      bestMoveUci: "e2e4",
      pv: ["e2e4"],
      source: "server",
    });

    await new Promise<void>((res) => setTimeout(res, 50));

    // eval at ply 1 should be set (from resolve2)
    const eval1 = coach.evalForPly(1);
    assert.ok(eval1 != null, "ply 1 eval should be set");

    // Now resolve ply 1's analysis late (should be discarded)
    const prevUpdateCount = updateCount;
    resolve1!({
      scoreCp: 999,
      mateIn: null,
      bestMoveUci: "e2e4",
      pv: [],
      source: "server",
    });
    await new Promise<void>((res) => setTimeout(res, 50));

    // Ply 1's eval should not have been overwritten with 999
    const eval1After = coach.evalForPly(1);
    assert.ok(eval1After != null);
    assert.notEqual(eval1After?.cp, 999, "stale ply 1 result should not overwrite ply 2");
  });

  it("shouldClassify=false: no banner even on huge swing", async () => {
    let callCount = 0;
    const analyzeFn: AnalyzeFn = async () => {
      callCount++;
      if (callCount === 1) return { scoreCp: 100, mateIn: null, bestMoveUci: "e2e4", pv: ["e2e4"], source: "server" };
      return { scoreCp: -900, mateIn: null, bestMoveUci: null, pv: [], source: "server" };
    };

    const coach = new LiveCoach(() => {}, analyzeFn);
    coach.enabled = true;

    const game = fromFEN(START_FEN);
    coach.onPositionChanged(game, 0, null, null, "white", false);
    await new Promise<void>((res) => setTimeout(res, 20));

    const moveObj = matchEngineMove(game, "e2e4");
    const game2 = game.copy();
    game2.applyMoveUnchecked(moveObj!, false);
    // shouldClassify = false (e.g. bot's move)
    coach.onPositionChanged(game2, 1, moveObj, null, "white", false);
    await new Promise<void>((res) => setTimeout(res, 20));

    assert.equal(coach.banner, null, "no banner when shouldClassify=false");
  });

  it("analyze rejection: state cleared, no banner, no throw", async () => {
    let called = false;
    const analyzeFn: AnalyzeFn = async () => {
      called = true;
      throw new Error("server down");
    };

    const coach = new LiveCoach(() => {}, analyzeFn);
    coach.enabled = true;

    const game = fromFEN(START_FEN);
    // Should not throw even with failing analyze
    await new Promise<void>((res) => {
      coach.onPositionChanged(game, 0, null, null, null, false);
      setTimeout(res, 50);
    });

    assert.ok(called, "analyze should have been called");
    assert.equal(coach.evalForBar, null, "evalForBar should be null after failure");
    assert.equal(coach.banner, null, "no banner on failure");
    assert.equal(coach.isAnalyzing, false, "isAnalyzing should be cleared");
  });

  it("dismissBanner: clears banner; next classified move sets a fresh one", async () => {
    let callCount = 0;
    const analyzeFn: AnalyzeFn = async () => {
      callCount++;
      if (callCount <= 1) return { scoreCp: 50, mateIn: null, bestMoveUci: "d1h5", pv: ["d1h5"], source: "server" };
      return { scoreCp: 850, mateIn: null, bestMoveUci: null, pv: [], source: "server" };
    };

    const coach = new LiveCoach(() => {}, analyzeFn);
    coach.enabled = true;

    const f = FIXTURES[0]; // HUNG_QUEEN
    const game0 = fromFEN(f.fen);
    coach.onPositionChanged(game0, 0, null, null, "white", false);
    await new Promise<void>((res) => setTimeout(res, 20));

    const moveObj = matchEngineMove(game0, f.movePlayed)!;
    const game1 = fromFEN(f.fen);
    game1.applyMoveUnchecked(moveObj, false);
    coach.onPositionChanged(game1, 1, moveObj, f.fen, "white", true);
    await new Promise<void>((res) => setTimeout(res, 20));

    // Banner should be set
    if (coach.banner) {
      coach.dismissBanner();
      assert.equal(coach.banner, null, "banner should be cleared after dismiss");
    }
  });

  it("hintWhyText: returns string when eval is cached, null otherwise", async () => {
    const analyzeFn: AnalyzeFn = async () => ({
      scoreCp: 120,
      mateIn: null,
      bestMoveUci: "e2e4",
      pv: ["e2e4"],
      source: "server",
    });

    const coach = new LiveCoach(() => {}, analyzeFn);
    coach.enabled = true;

    // No eval cached yet
    const game = fromFEN(START_FEN);
    const hint = matchEngineMove(game, "e2e4");
    assert.ok(hint != null);
    assert.equal(coach.hintWhyText(game, hint!), null, "no text without cached eval");

    // Now set eval
    coach.onPositionChanged(game, 0, null, null, null, false);
    await new Promise<void>((res) => setTimeout(res, 20));

    const text = coach.hintWhyText(game, hint!);
    assert.ok(text !== null, "should return text with cached eval");
    assert.ok(typeof text === "string", "should be a string");
  });
});
