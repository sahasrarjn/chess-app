import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  difficultyElo,
  difficultyMovetime,
  difficultyMinThinkMs,
  difficultySearchDepth,
  difficultyRandomness,
  type BotDifficulty,
} from "./types";

const LEVELS: BotDifficulty[] = ["easy", "medium", "hard"];

describe("difficulty mappings", () => {
  it("defines every parameter for all three levels", () => {
    for (const level of LEVELS) {
      assert.equal(typeof difficultyElo(level), "number", `elo ${level}`);
      assert.equal(typeof difficultyMovetime(level), "number", `movetime ${level}`);
      assert.equal(typeof difficultyMinThinkMs(level), "number", `minThink ${level}`);
      assert.equal(typeof difficultySearchDepth(level), "number", `depth ${level}`);
      assert.equal(typeof difficultyRandomness(level), "number", `randomness ${level}`);
    }
  });

  it("makes easy very weak (shallow search, frequent random moves)", () => {
    assert.equal(difficultySearchDepth("easy"), 1);
    assert.ok(difficultyRandomness("easy") >= 0.5, "easy plays a random move at least half the time");
    assert.ok(difficultyElo("easy") <= 1000, "easy targets a low engine Elo");
  });

  it("keeps strength monotonic across levels", () => {
    for (let i = 1; i < LEVELS.length; i++) {
      const lower = LEVELS[i - 1];
      const higher = LEVELS[i];
      assert.ok(
        difficultyElo(lower) < difficultyElo(higher),
        `elo ${lower} < ${higher}`
      );
      assert.ok(
        difficultySearchDepth(lower) <= difficultySearchDepth(higher),
        `depth ${lower} <= ${higher}`
      );
      assert.ok(
        difficultyRandomness(lower) >= difficultyRandomness(higher),
        `randomness ${lower} >= ${higher}`
      );
    }
  });
});
