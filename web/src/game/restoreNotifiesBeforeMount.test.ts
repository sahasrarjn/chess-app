/**
 * Documents the contract that GameController.restoreGame() calls the onUpdate
 * callback synchronously during construction — before any UI is mounted.
 * Consumers (e.g. GameScreen) must tolerate pre-mount notifications and guard
 * their update() accordingly.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameController } from "./gameController";
import { restoreGameFromSnapshot, type SavedGameSnapshot } from "./savedGame";

const SNAPSHOT: SavedGameSnapshot = {
  version: 1,
  mode: "vsBot",
  botDifficulty: "easy",
  moves: ["e2e4", "e7e5"],
  resignedBy: null,
  boardFlipped: false,
  autoFlipBoard: true,
};

describe("GameController.restoreGame", () => {
  it("notifies the update callback synchronously before the caller can mount a UI", () => {
    let callCount = 0;

    const ctrl = new GameController("vsBot", "easy", () => {
      callCount++;
    });

    const game = restoreGameFromSnapshot(SNAPSHOT);
    assert.ok(game, "snapshot must produce a valid game");

    // restoreGame must call onUpdate at least once — the caller's update()
    // must tolerate being invoked before any DOM nodes exist.
    ctrl.restoreGame(game, SNAPSHOT.boardFlipped, SNAPSHOT.autoFlipBoard);

    assert.ok(callCount >= 1, "restoreGame must notify the update callback");
  });

  it("does not throw when the update callback is a no-op guard (simulating pre-mount)", () => {
    let mounted = false;
    let earlyCallCount = 0;

    const onUpdate = (): void => {
      if (!mounted) {
        earlyCallCount++;
        return; // guard — equivalent to GameScreen.update()'s mounted check
      }
    };

    const ctrl = new GameController("vsBot", "easy", onUpdate);
    const game = restoreGameFromSnapshot(SNAPSHOT);
    assert.ok(game);

    assert.doesNotThrow(() => {
      ctrl.restoreGame(game, SNAPSHOT.boardFlipped, SNAPSHOT.autoFlipBoard);
    });

    assert.ok(earlyCallCount >= 1, "pre-mount notifications were silently dropped");
  });
});
