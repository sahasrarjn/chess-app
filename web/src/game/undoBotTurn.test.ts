import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameController } from "./gameController";

/** Apply the first legal move n times directly on the underlying game. */
function applyOpeningMoves(ctrl: GameController, n: number): void {
  for (let i = 0; i < n; i++) {
    const moves = ctrl.game.legalMoves();
    assert.ok(moves.length > 0, "position should have legal moves");
    assert.ok(ctrl.game.applyMove(moves[0]));
  }
}

describe("GameController.undo (vsBot)", () => {
  it("undoing while the bot is thinking returns to the player's turn, not the bot's", () => {
    const ctrl = new GameController("vsBot", "easy");
    // [white, black, white] -> black (the bot) to move, i.e. bot is thinking.
    applyOpeningMoves(ctrl, 3);
    assert.equal(ctrl.game.activeColor, "black");
    ctrl.isThinking = true; // simulate the in-flight bot request

    ctrl.undo();

    assert.equal(ctrl.isThinking, false, "thinking flag must clear");
    assert.equal(ctrl.game.activeColor, "white", "should land on the player's turn");
    assert.equal(ctrl.isBotTurn, false, "must not be stuck on the bot's turn");
    assert.notEqual(ctrl.statusText(), "Bot is thinking…", "must not be stuck thinking");
  });

  it("undoing on the player's turn rolls back a full round (your move + bot reply)", () => {
    const ctrl = new GameController("vsBot", "easy");
    applyOpeningMoves(ctrl, 4); // [w,b,w,b] -> white (player) to move
    const before = ctrl.game.recordedMoves.length;

    ctrl.undo();

    assert.equal(ctrl.game.activeColor, "white", "still the player's turn");
    assert.equal(ctrl.game.recordedMoves.length, before - 2, "rolls back a full round");
  });
});
