import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyMoveSound } from "./classifyMoveSound";
import type { Move } from "../engine/types";

const m = (extra: Partial<Move> = {}): Move => ({
  from: { row: 6, col: 4 },
  to: { row: 4, col: 4 },
  ...extra,
});

describe("classifyMoveSound", () => {
  it("returns 'move' for a plain non-capturing move", () => {
    assert.equal(
      classifyMoveSound({ resultType: "ongoing", givesCheck: false, captured: false, move: m() }),
      "move"
    );
  });

  it("returns 'capture' when a piece is taken", () => {
    assert.equal(
      classifyMoveSound({ resultType: "ongoing", givesCheck: false, captured: true, move: m() }),
      "capture"
    );
  });

  it("returns 'castle' for castling", () => {
    assert.equal(
      classifyMoveSound({ resultType: "ongoing", givesCheck: false, captured: false, move: m({ isCastle: true }) }),
      "castle"
    );
  });

  it("returns 'promote' for a promotion", () => {
    assert.equal(
      classifyMoveSound({ resultType: "ongoing", givesCheck: false, captured: false, move: m({ promotion: "Q" }) }),
      "promote"
    );
  });

  it("returns 'check' when the move gives check", () => {
    assert.equal(
      classifyMoveSound({ resultType: "ongoing", givesCheck: true, captured: false, move: m() }),
      "check"
    );
  });

  it("prefers 'check' over capture/promote", () => {
    assert.equal(
      classifyMoveSound({ resultType: "ongoing", givesCheck: true, captured: true, move: m({ promotion: "Q" }) }),
      "check"
    );
  });

  it("returns 'game-end' on checkmate even when it is also a capturing check", () => {
    assert.equal(
      classifyMoveSound({ resultType: "checkmate", givesCheck: true, captured: true, move: m() }),
      "game-end"
    );
  });

  it("returns 'game-end' for stalemate and draw", () => {
    assert.equal(
      classifyMoveSound({ resultType: "stalemate", givesCheck: false, captured: false, move: m() }),
      "game-end"
    );
    assert.equal(
      classifyMoveSound({ resultType: "draw", givesCheck: false, captured: false, move: m() }),
      "game-end"
    );
  });

  it("prefers 'promote' over 'castle' and 'capture'", () => {
    assert.equal(
      classifyMoveSound({ resultType: "ongoing", givesCheck: false, captured: true, move: m({ promotion: "Q" }) }),
      "promote"
    );
  });
});
