# Board Color Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 8 selectable board color palettes (incl. Rosewood and Blossom pink themes) with a settings UI, persisted locally, on web and iOS with identical hex values.

**Architecture:** Web — a pure-TS theme registry whose `applyBoardTheme` writes the existing `--light-square`/`--dark-square` CSS variables on `:root`; selection persists to `localStorage`. iOS — a `BoardPalette` registry + `BoardThemeStore` (ObservableObject backed by `UserDefaults`); the existing `BoardTheme` square-color statics become computed properties delegating to the store, so all call sites stay unchanged.

**Tech Stack:** Vanilla TypeScript + `node:test` via `tsx` (web), SwiftUI + XCTest via the `ChessBorderMac` scheme (iOS), `xcodegen` for project regeneration.

**Branch:** create `board-themes` off `production-features-spec`. Spec: `docs/superpowers/specs/2026-06-11-production-features-design.md` (Phase 1).

**Conventions:** imperative commit subjects, no `feat:` prefixes (match `git log`), HEREDOC commit messages, NO Claude co-author trailer.

---

## File Structure

| File | Responsibility |
|---|---|
| `web/src/theme/boardThemes.ts` (create) | Theme registry, persistence, CSS-variable application. Pure functions; DOM/localStorage injectable for tests. |
| `web/src/theme/boardThemes.test.ts` (create) | Registry + persistence + application tests. |
| `web/src/ui/settingsPanel.ts` (create) | Settings modal (theme swatch grid) + gear-button factory. |
| `web/src/main.ts` (modify) | Apply saved theme at boot. |
| `web/src/ui/home.ts` (modify) | Gear button on home screen. |
| `web/src/ui/gameView.ts` (modify) | Gear button in game header. |
| `web/src/styles.css` (modify) | Overlay/swatch/gear CSS. |
| `ChessBorder/ChessBorder/Theme/BoardPalette.swift` (create) | Palette struct, 8 presets, hex `Color` init. |
| `ChessBorder/ChessBorder/Theme/BoardThemeStore.swift` (create) | ObservableObject store, UserDefaults persistence. |
| `ChessBorder/ChessBorder/Theme/BoardTheme.swift` (modify) | Square-color statics delegate to store. |
| `ChessBorder/ChessBorder/Views/SettingsView.swift` (create) | Settings sheet with swatch grid. |
| `ChessBorder/ChessBorder/Views/HomeView.swift` (modify) | Gear button + sheet. |
| `ChessBorder/ChessBorder/Views/GameView.swift` (modify) | Gear nav action + sheet. |
| `ChessBorder/ChessBorder/Views/BoardView.swift` (modify) | Observe store so board recolors live. |
| `ChessBorder/ChessBorderTests/BoardThemeTests.swift` (create) | Palette + store tests. |

## Shared palette values (single source of truth — use these exact hexes on both platforms)

| id | name | light | dark |
|---|---|---|---|
| `classic` | Classic Green | `#eeeed1` | `#769656` |
| `walnut` | Walnut | `#f0d9b5` | `#b58863` |
| `ocean` | Ocean | `#e3ecf2` | `#6e98b5` |
| `slate` | Slate | `#e4e6e9` | `#7d848d` |
| `tournament` | Tournament | `#ffce9e` | `#d18b47` |
| `high-contrast` | High Contrast | `#ffffff` | `#444444` |
| `rosewood` | Rosewood | `#f1dcd6` | `#a8716e` |
| `blossom` | Blossom | `#fbeef2` | `#d98ea4` |

`classic` must match the current `:root` values in `web/src/styles.css:7-8` — it is the default and changes nothing for existing users.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/sahasra/Personal/work/chess-app
git checkout production-features-spec && git checkout -b board-themes
```

### Task 1: Web theme registry

**Files:**
- Create: `web/src/theme/boardThemes.ts`
- Test: `web/src/theme/boardThemes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/theme/boardThemes.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test`
Expected: FAIL — `Cannot find module './boardThemes'`

- [ ] **Step 3: Write the implementation**

Create `web/src/theme/boardThemes.ts`:

```ts
export type BoardThemeId =
  | "classic"
  | "walnut"
  | "ocean"
  | "slate"
  | "tournament"
  | "contrast"
  | "rosewood"
  | "blossom";

export type BoardThemePreset = {
  id: BoardThemeId;
  name: string;
  lightSquare: string;
  darkSquare: string;
};

export const BOARD_THEMES: readonly BoardThemePreset[] = [
  { id: "classic", name: "Classic Green", lightSquare: "#eeeed1", darkSquare: "#769656" },
  { id: "walnut", name: "Walnut", lightSquare: "#f0d9b5", darkSquare: "#b58863" },
  { id: "ocean", name: "Ocean", lightSquare: "#e3ecf2", darkSquare: "#6e98b5" },
  { id: "slate", name: "Slate", lightSquare: "#e4e6e9", darkSquare: "#7d848d" },
  { id: "tournament", name: "Tournament", lightSquare: "#ffce9e", darkSquare: "#d18b47" },
  { id: "contrast", name: "High Contrast", lightSquare: "#ffffff", darkSquare: "#444444" },
  { id: "rosewood", name: "Rosewood", lightSquare: "#f1dcd6", darkSquare: "#a8716e" },
  { id: "blossom", name: "Blossom", lightSquare: "#fbeef2", darkSquare: "#d98ea4" },
];

export const DEFAULT_BOARD_THEME_ID: BoardThemeId = "classic";

const STORAGE_KEY = "chessborder.boardTheme";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function boardThemeById(id: string | null | undefined): BoardThemePreset {
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
}

export function loadBoardThemeId(storage: ThemeStorage = localStorage): BoardThemeId {
  try {
    return boardThemeById(storage.getItem(STORAGE_KEY)).id;
  } catch {
    return DEFAULT_BOARD_THEME_ID;
  }
}

export function saveBoardThemeId(id: BoardThemeId, storage: ThemeStorage = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing or storage denied: theme just won't persist.
  }
}

type StylableRoot = { style: Pick<CSSStyleDeclaration, "setProperty"> };

export function applyBoardTheme(
  theme: BoardThemePreset,
  root: StylableRoot = document.documentElement
): void {
  root.style.setProperty("--light-square", theme.lightSquare);
  root.style.setProperty("--dark-square", theme.darkSquare);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test`
Expected: PASS (all suites, including the 9 pre-existing test files)

- [ ] **Step 5: Commit**

```bash
git add web/src/theme/boardThemes.ts web/src/theme/boardThemes.test.ts
git commit -m "$(cat <<'EOF'
Add board theme registry with 8 palettes on web

Classic Green stays the default; adds Walnut, Ocean, Slate,
Tournament, High Contrast, Rosewood, and Blossom.
EOF
)"
```

### Task 2: Apply saved theme at web boot

**Files:**
- Modify: `web/src/main.ts:1-6`

- [ ] **Step 1: Apply the theme right after the stylesheet import**

In `web/src/main.ts`, the file currently starts:

```ts
import "./styles.css";
import { loadSavedGame } from "./game/savedGame";
```

Change the top of the file to:

```ts
import "./styles.css";
import { applyBoardTheme, boardThemeById, loadBoardThemeId } from "./theme/boardThemes";
import { loadSavedGame } from "./game/savedGame";

applyBoardTheme(boardThemeById(loadBoardThemeId()));
```

(The apply call goes above the existing `void import("./analytics/posthog")...` line.)

- [ ] **Step 2: Verify build and behavior**

Run: `cd web && npm run build`
Expected: clean `tsc` + vite build.

Run: `cd web && npm run dev`, open the printed URL, then in the browser console run
`localStorage.setItem("chessborder.boardTheme", "rosewood"); location.reload()`
Expected: board squares render pink/brown. Then `localStorage.removeItem("chessborder.boardTheme"); location.reload()` restores green.

- [ ] **Step 3: Commit**

```bash
git add web/src/main.ts
git commit -m "Apply saved board theme at web boot"
```

### Task 3: Web settings UI (gear + theme swatches)

**Files:**
- Create: `web/src/ui/settingsPanel.ts`
- Modify: `web/src/ui/home.ts:89-91` (append gear), `web/src/ui/gameView.ts:115-124` (header gear)
- Modify: `web/src/styles.css` (append new rules; `.home` rule gets `position: relative`)

- [ ] **Step 1: Create the settings panel module**

Create `web/src/ui/settingsPanel.ts`:

```ts
import {
  BOARD_THEMES,
  applyBoardTheme,
  loadBoardThemeId,
  saveBoardThemeId,
} from "../theme/boardThemes";

const GEAR_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z"></path></svg>`;

export function openSettingsPanel(): void {
  const overlay = document.createElement("div");
  overlay.className = "settings-overlay";
  const close = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  const panel = document.createElement("div");
  panel.className = "settings-panel settings-modal";

  const title = document.createElement("h2");
  title.textContent = "Settings";
  panel.appendChild(title);

  const label = document.createElement("label");
  label.textContent = "Board theme";
  panel.appendChild(label);

  const grid = document.createElement("div");
  grid.className = "theme-swatches";
  const activeId = loadBoardThemeId();
  for (const theme of BOARD_THEMES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-swatch" + (theme.id === activeId ? " active" : "");
    btn.style.setProperty("--sw-light", theme.lightSquare);
    btn.style.setProperty("--sw-dark", theme.darkSquare);
    btn.setAttribute("aria-label", `${theme.name} board theme`);
    const name = document.createElement("span");
    name.textContent = theme.name;
    btn.appendChild(name);
    btn.onclick = () => {
      saveBoardThemeId(theme.id);
      applyBoardTheme(theme);
      grid.querySelectorAll(".theme-swatch").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
    };
    grid.appendChild(btn);
  }
  panel.appendChild(grid);

  const done = document.createElement("button");
  done.type = "button";
  done.className = "primary";
  done.textContent = "Done";
  done.onclick = close;
  panel.appendChild(done);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

export function createSettingsButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn settings-toggle";
  btn.innerHTML = GEAR_SVG;
  btn.title = "Settings";
  btn.setAttribute("aria-label", "Open settings");
  btn.onclick = () => openSettingsPanel();
  return btn;
}
```

- [ ] **Step 2: Add the gear to the home screen**

In `web/src/ui/home.ts`, add the import at the top:

```ts
import { createSettingsButton } from "./settingsPanel";
```

and in `renderHome`'s `render` function, just before `root.appendChild(home);` (currently line 91):

```ts
    const gear = createSettingsButton();
    gear.classList.add("home-settings");
    home.appendChild(gear);
```

- [ ] **Step 3: Add the gear to the game header**

In `web/src/ui/gameView.ts`, add the import near the other `./` imports at the top of the file:

```ts
import { createSettingsButton } from "./settingsPanel";
```

and after `header.appendChild(this.hintBtn);` (currently line 123):

```ts
    header.appendChild(createSettingsButton());
```

- [ ] **Step 4: Add the CSS**

In `web/src/styles.css`, find the `.home` rule (it styles the home column) and add `position: relative;` to it. Then append at the end of the file (before the `@media` block if the file ends with one; otherwise at the very end):

```css
/* Settings */
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 50;
}

.settings-modal {
  max-width: 420px;
  max-height: min(80dvh, 560px);
  overflow-y: auto;
}

.settings-modal h2 {
  margin: 0;
  font-size: 1.1rem;
}

.theme-swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 10px;
}

.theme-swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: var(--bg);
  border-radius: 10px;
}

.theme-swatch::before {
  content: "";
  width: 56px;
  height: 56px;
  border-radius: 8px;
  background: conic-gradient(
    var(--sw-light) 25%,
    var(--sw-dark) 0 50%,
    var(--sw-light) 0 75%,
    var(--sw-dark) 0
  );
}

.theme-swatch span {
  font-size: 0.7rem;
  color: var(--muted);
}

.theme-swatch.active {
  outline: 2px solid var(--accent);
}

.home-settings {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top));
  right: 12px;
  color: var(--muted);
}
```

- [ ] **Step 5: Verify**

Run: `cd web && npm test && npm run build`
Expected: tests PASS, clean build.

Run: `cd web && npm run dev` and check in the browser:
1. Gear visible top-right on home; opens the modal; selecting Blossom recolors nothing visible yet (home has no board) but persists — reload, start a game, board is pink.
2. In-game gear opens the same modal; picking a different theme recolors the board **immediately** (CSS variables are live).
3. Close via Done and via clicking the backdrop.

- [ ] **Step 6: Commit**

```bash
git add web/src/ui/settingsPanel.ts web/src/ui/home.ts web/src/ui/gameView.ts web/src/styles.css
git commit -m "Add settings panel with board theme swatches on web"
```

### Task 4: iOS palette registry + store

**Files:**
- Create: `ChessBorder/ChessBorder/Theme/BoardPalette.swift`
- Create: `ChessBorder/ChessBorder/Theme/BoardThemeStore.swift`
- Modify: `ChessBorder/ChessBorder/Theme/BoardTheme.swift:3-8`
- Test: `ChessBorder/ChessBorderTests/BoardThemeTests.swift`

- [ ] **Step 1: Write the failing test**

Create `ChessBorder/ChessBorderTests/BoardThemeTests.swift`:

```swift
import XCTest
import SwiftUI
@testable import Border_Chess

final class BoardThemeTests: XCTestCase {
    func testRegistryHasEightUniquePalettes() {
        XCTAssertEqual(BoardPalette.all.count, 8)
        XCTAssertEqual(Set(BoardPalette.all.map(\.id)).count, 8)
    }

    func testClassicIsDefaultAndMatchesLegacyBoardColors() {
        let classic = BoardPalette.palette(forId: nil)
        XCTAssertEqual(classic.id, "classic")
        XCTAssertEqual(classic.lightSquare, Color(srgbHex: 0xEEEED1))
        XCTAssertEqual(classic.darkSquare, Color(srgbHex: 0x769656))
    }

    func testIncludesPinkPalettes() {
        let ids = BoardPalette.all.map(\.id)
        XCTAssertTrue(ids.contains("rosewood"))
        XCTAssertTrue(ids.contains("blossom"))
    }

    func testUnknownIdFallsBackToClassic() {
        XCTAssertEqual(BoardPalette.palette(forId: "junk").id, "classic")
    }

    func testStorePersistsSelectionAcrossInstances() {
        let suite = "BoardThemeTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let store = BoardThemeStore(defaults: defaults)
        XCTAssertEqual(store.palette.id, "classic")
        store.palette = BoardPalette.palette(forId: "rosewood")

        let reloaded = BoardThemeStore(defaults: defaults)
        XCTAssertEqual(reloaded.palette.id, "rosewood")
    }
}
```

Note: the `@testable import` module name must match the existing test files — open `ChessBorder/ChessBorderTests/BotEvalTests.swift` and copy its exact import line (the Mac target product is "Border Chess", so the module is likely `Border_Chess`; trust the existing file over this plan).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/sahasra/Personal/work/chess-app/ChessBorder
xcodegen generate
xcodebuild test -project ChessBorder.xcodeproj -scheme ChessBorderMac \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath build/DerivedData \
  -only-testing:ChessBorderTests/BoardThemeTests 2>&1 | tail -20
```

Expected: BUILD FAILED — `cannot find 'BoardPalette' in scope`

- [ ] **Step 3: Implement palette + store, and delegate BoardTheme square colors**

Create `ChessBorder/ChessBorder/Theme/BoardPalette.swift`:

```swift
import SwiftUI

/// A selectable board color palette. Hex values must stay identical to
/// web/src/theme/boardThemes.ts so both platforms match.
struct BoardPalette: Equatable, Identifiable {
    let id: String
    let name: String
    let lightSquare: Color
    let darkSquare: Color

    static let all: [BoardPalette] = [
        BoardPalette(id: "classic", name: "Classic Green",
                     lightSquare: Color(srgbHex: 0xEEEED1), darkSquare: Color(srgbHex: 0x769656)),
        BoardPalette(id: "walnut", name: "Walnut",
                     lightSquare: Color(srgbHex: 0xF0D9B5), darkSquare: Color(srgbHex: 0xB58863)),
        BoardPalette(id: "ocean", name: "Ocean",
                     lightSquare: Color(srgbHex: 0xE3ECF2), darkSquare: Color(srgbHex: 0x6E98B5)),
        BoardPalette(id: "slate", name: "Slate",
                     lightSquare: Color(srgbHex: 0xE4E6E9), darkSquare: Color(srgbHex: 0x7D848D)),
        BoardPalette(id: "tournament", name: "Tournament",
                     lightSquare: Color(srgbHex: 0xFFCE9E), darkSquare: Color(srgbHex: 0xD18B47)),
        BoardPalette(id: "high-contrast", name: "High Contrast",
                     lightSquare: Color(srgbHex: 0xFFFFFF), darkSquare: Color(srgbHex: 0x444444)),
        BoardPalette(id: "rosewood", name: "Rosewood",
                     lightSquare: Color(srgbHex: 0xF1DCD6), darkSquare: Color(srgbHex: 0xA8716E)),
        BoardPalette(id: "blossom", name: "Blossom",
                     lightSquare: Color(srgbHex: 0xFBEEF2), darkSquare: Color(srgbHex: 0xD98EA4)),
    ]

    static func palette(forId id: String?) -> BoardPalette {
        all.first { $0.id == id } ?? all[0]
    }
}

extension Color {
    init(srgbHex hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
```

Create `ChessBorder/ChessBorder/Theme/BoardThemeStore.swift`:

```swift
import SwiftUI

/// Holds the selected board palette; persists the choice to UserDefaults.
final class BoardThemeStore: ObservableObject {
    static let shared = BoardThemeStore()
    static let defaultsKey = "chessborder.boardTheme"

    @Published var palette: BoardPalette {
        didSet { defaults.set(palette.id, forKey: Self.defaultsKey) }
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.palette = BoardPalette.palette(forId: defaults.string(forKey: Self.defaultsKey))
    }
}
```

Modify `ChessBorder/ChessBorder/Theme/BoardTheme.swift` lines 3-8 — replace:

```swift
enum BoardTheme {
    static let lightSquare = Color(red: 0.93, green: 0.93, blue: 0.82)
    static let darkSquare = Color(red: 0.46, green: 0.59, blue: 0.33)
    /// Border uses the same checker as the inner board - empty frame, not a separate zone.
    static let borderLightSquare = lightSquare
    static let borderDarkSquare = darkSquare
```

with:

```swift
enum BoardTheme {
    static var lightSquare: Color { BoardThemeStore.shared.palette.lightSquare }
    static var darkSquare: Color { BoardThemeStore.shared.palette.darkSquare }
    /// Border uses the same checker as the inner board - empty frame, not a separate zone.
    static var borderLightSquare: Color { lightSquare }
    static var borderDarkSquare: Color { darkSquare }
```

All other `BoardTheme` members (highlights, chrome) stay untouched, as do all call sites.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/sahasra/Personal/work/chess-app/ChessBorder
xcodegen generate
xcodebuild test -project ChessBorder.xcodeproj -scheme ChessBorderMac \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath build/DerivedData \
  -only-testing:ChessBorderTests/BoardThemeTests 2>&1 | tail -20
```

Expected: `** TEST SUCCEEDED **`

- [ ] **Step 5: Commit**

```bash
git add ChessBorder/ChessBorder/Theme/BoardPalette.swift \
        ChessBorder/ChessBorder/Theme/BoardThemeStore.swift \
        ChessBorder/ChessBorder/Theme/BoardTheme.swift \
        ChessBorder/ChessBorderTests/BoardThemeTests.swift
git commit -m "$(cat <<'EOF'
Add board palette registry and theme store on iOS

BoardTheme square colors now delegate to a UserDefaults-backed
BoardThemeStore; all call sites unchanged. Classic stays default.
EOF
)"
```

### Task 5: iOS settings sheet + gear buttons

**Files:**
- Create: `ChessBorder/ChessBorder/Views/SettingsView.swift`
- Modify: `ChessBorder/ChessBorder/Views/HomeView.swift:31-111`
- Modify: `ChessBorder/ChessBorder/Views/GameView.swift:143-175`
- Modify: `ChessBorder/ChessBorder/Views/BoardView.swift` (top of struct)

- [ ] **Step 1: Create the settings sheet**

Create `ChessBorder/ChessBorder/Views/SettingsView.swift`:

```swift
import SwiftUI

struct SettingsView: View {
    @ObservedObject private var themeStore = BoardThemeStore.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                BoardTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Board theme")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.7))

                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 12)], spacing: 12) {
                            ForEach(BoardPalette.all) { palette in
                                ThemeSwatch(
                                    palette: palette,
                                    isSelected: themeStore.palette.id == palette.id
                                ) {
                                    themeStore.palette = palette
                                }
                            }
                        }
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                Button("Done") { dismiss() }
            }
        }
        .preferredColorScheme(.dark)
    }
}

private struct ThemeSwatch: View {
    let palette: BoardPalette
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                    GridRow {
                        Rectangle().fill(palette.lightSquare)
                        Rectangle().fill(palette.darkSquare)
                    }
                    GridRow {
                        Rectangle().fill(palette.darkSquare)
                        Rectangle().fill(palette.lightSquare)
                    }
                }
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                Text(palette.name)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.75))
            }
            .padding(10)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(BoardTheme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(isSelected ? BoardTheme.accent : BoardTheme.border,
                            lineWidth: isSelected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    SettingsView()
}
```

- [ ] **Step 2: Gear on the home screen**

In `ChessBorder/ChessBorder/Views/HomeView.swift`:

Add state next to the other `@State` vars (after line 10 `@State private var onlineRoom: OnlineRoom?`):

```swift
    @State private var showSettings = false
```

In `homeContent`, attach an overlay + sheet to the `ZStack` — after the line `.chessAppNavigationChromeHidden()` (line 103) and before `.navigationDestination(...)`, insert:

```swift
            .overlay(alignment: .topTrailing) {
                Button {
                    showSettings = true
                } label: {
                    Image(systemName: "gearshape")
                        .font(.title3)
                        .foregroundStyle(.white.opacity(0.6))
                        .padding(14)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
```

- [ ] **Step 3: Gear in the game header**

In `ChessBorder/ChessBorder/Views/GameView.swift`:

Add state next to the existing `@State` vars (search for `@State private var showResignConfirm`):

```swift
    @State private var showSettings = false
```

In `header` (line 150, the trailing `HStack(spacing: 12)`), after the sound `GameNavIconAction` (line 169-172), add:

```swift
                GameNavIconAction(
                    systemName: "gearshape",
                    action: { showSettings = true }
                )
```

On the view that `header` belongs to, attach the sheet alongside the existing `.confirmationDialog` (line 130) — add after line 135 (`}` closing the dialog):

```swift
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
```

- [ ] **Step 4: Make the board observe the store**

In `ChessBorder/ChessBorder/Views/BoardView.swift`, add as the first property inside `struct BoardView`:

```swift
    @ObservedObject private var themeStore = BoardThemeStore.shared
```

This subscribes the board to palette changes so an in-game theme switch recolors immediately (the static `BoardTheme.lightSquare` reads are not otherwise change-tracked by SwiftUI).

- [ ] **Step 5: Build, test, and verify by running**

```bash
cd /Users/sahasra/Personal/work/chess-app/ChessBorder
xcodegen generate
xcodebuild test -project ChessBorder.xcodeproj -scheme ChessBorderMac \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath build/DerivedData 2>&1 | tail -5
```

Expected: `** TEST SUCCEEDED **` (full suite).

Then `./run.sh mac` and verify: gear on home opens Settings; picking Rosewood and starting a game shows the pink board; opening the in-game gear and picking another theme recolors the board live; relaunching the app keeps the choice.

- [ ] **Step 6: Commit**

```bash
git add ChessBorder/ChessBorder/Views/SettingsView.swift \
        ChessBorder/ChessBorder/Views/HomeView.swift \
        ChessBorder/ChessBorder/Views/GameView.swift \
        ChessBorder/ChessBorder/Views/BoardView.swift
git commit -m "Add settings sheet with board theme picker on iOS"
```

### Task 6: Final verification

- [ ] **Step 1: Full web suite + build**

Run: `cd web && npm test && npm run build`
Expected: all tests PASS, clean build.

- [ ] **Step 2: Full Mac test suite**

```bash
cd /Users/sahasra/Personal/work/chess-app/ChessBorder
xcodebuild test -project ChessBorder.xcodeproj -scheme ChessBorderMac \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath build/DerivedData 2>&1 | tail -5
```

Expected: `** TEST SUCCEEDED **`

- [ ] **Step 3: iOS Simulator smoke build**

```bash
cd /Users/sahasra/Personal/work/chess-app/ChessBorder
xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorder -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath build/DerivedData build 2>&1 | tail -3
```

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Mark Phase 1 done**

No deploy in this plan — `./scripts/deploy-site.sh` ships the web change when the user asks. Report completion and hand back for review.
