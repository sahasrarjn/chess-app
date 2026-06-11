import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOARD_THEMES,
  DEFAULT_BOARD_THEME_ID,
  applyBoardTheme,
  boardThemeById,
  loadBoardThemeId,
  saveBoardThemeId,
} from "./boardThemes";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("board theme registry", () => {
  it("defines 8 themes with unique ids", () => {
    assert.equal(BOARD_THEMES.length, 8);
    assert.equal(new Set(BOARD_THEMES.map((t) => t.id)).size, 8);
  });

  it("keeps classic as the default with the original board colors", () => {
    assert.equal(DEFAULT_BOARD_THEME_ID, "classic");
    const classic = boardThemeById("classic");
    assert.equal(classic.lightSquare, "#eeeed1");
    assert.equal(classic.darkSquare, "#769656");
  });

  it("includes the pink palettes", () => {
    const ids = BOARD_THEMES.map((t) => t.id);
    assert.ok(ids.includes("rosewood"));
    assert.ok(ids.includes("blossom"));
  });

  it("uses valid 6-digit hex colors everywhere", () => {
    for (const t of BOARD_THEMES) {
      assert.match(t.lightSquare, /^#[0-9a-f]{6}$/, `${t.id} light`);
      assert.match(t.darkSquare, /^#[0-9a-f]{6}$/, `${t.id} dark`);
    }
  });

  it("falls back to classic for unknown ids", () => {
    assert.equal(boardThemeById("nope").id, "classic");
    assert.equal(boardThemeById(null).id, "classic");
    assert.equal(boardThemeById(undefined).id, "classic");
  });
});

describe("board theme persistence", () => {
  it("round-trips the selected theme id", () => {
    const storage = fakeStorage();
    saveBoardThemeId("rosewood", storage);
    assert.equal(loadBoardThemeId(storage), "rosewood");
  });

  it("returns the default for empty or garbage storage", () => {
    assert.equal(loadBoardThemeId(fakeStorage()), "classic");
    assert.equal(
      loadBoardThemeId(fakeStorage({ "chessborder.boardTheme": "junk" })),
      "classic"
    );
  });

  it("survives a throwing storage (private browsing)", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    assert.equal(loadBoardThemeId(broken), "classic");
    assert.doesNotThrow(() => saveBoardThemeId("ocean", broken));
  });
});

describe("applyBoardTheme", () => {
  it("sets both square CSS variables on the root element", () => {
    const set = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string) => void set.set(k, v) } };
    applyBoardTheme(boardThemeById("walnut"), root);
    assert.equal(set.get("--light-square"), "#f0d9b5");
    assert.equal(set.get("--dark-square"), "#b58863");
  });
});
