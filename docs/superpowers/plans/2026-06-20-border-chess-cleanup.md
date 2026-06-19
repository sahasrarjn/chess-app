# Border Chess Cleanup & UX Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the live coach/eval-bar system, fix the board highlight subpixel glitch, add Fairy Stockfish explanation and new-tab iPhone link on the landing page, make session persistence robust with a Resume button, and add a "back to live" banner when browsing move history.

**Architecture:** All changes are in `web/src/` (TypeScript + vanilla DOM) and `web/index.html` (static landing page). No new dependencies. Five independent tasks that can be committed separately; Tasks 4 and 5 both touch `gameView.ts` so do them in order.

**Tech Stack:** TypeScript, Vite, Node.js test runner via `tsx --test`

## Global Constraints

- Test command: `cd web && npm test` — must exit 0 before every commit
- Build command: `cd web && npm run build` — must exit 0 before every commit
- No new npm dependencies
- All files are under `web/src/` unless stated otherwise
- Do not commit unless tests and build both pass

---

## Task 1: Remove live coach

**Files:**
- Delete: `web/src/coach/liveCoach.ts`
- Delete: `web/src/coach/liveCoach.test.ts`
- Delete: `web/src/ui/evalBar.ts`
- Delete: `web/src/coach/coachSettings.ts`
- Delete: `web/src/coach/coachSettings.test.ts`
- Delete: `web/src/coach/explain.ts`
- Delete: `web/src/coach/explain.test.ts`
- Keep: `web/src/coach/testFixtures.ts` (imported by `classify.test.ts`, `analyzeClient.test.ts`, `review.test.ts`)
- Modify: `web/src/ui/gameView.ts`
- Modify: `web/src/ui/settingsPanel.ts`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: nothing new
- Produces: `gameView.ts` and `settingsPanel.ts` with no coach references; test suite still passes

- [ ] **Step 1: Delete the seven coach files**

```bash
cd web
rm src/coach/liveCoach.ts src/coach/liveCoach.test.ts
rm src/ui/evalBar.ts
rm src/coach/coachSettings.ts src/coach/coachSettings.test.ts
rm src/coach/explain.ts src/coach/explain.test.ts
```

- [ ] **Step 2: Remove coach imports from `gameView.ts`**

Remove these four import lines (they are at the top of the file):

```ts
// DELETE these lines:
import { EvalBar } from "./evalBar";
import { LiveCoach } from "../coach/liveCoach";
import { loadCoachEnabled } from "../coach/coachSettings";
import { toFEN } from "../engine/fen";
```

`moveUci` and `MoveClassification` imports are used by the review feature — leave them.

- [ ] **Step 3: Remove coach fields from `GameScreen` class**

Delete these six field declarations near the top of the `GameScreen` class:

```ts
// DELETE these lines:
// Coach fields
private readonly coach = new LiveCoach(() => this.updateCoach());
private readonly evalBar = new EvalBar();
private coachBannerEl: HTMLElement | null = null;
private hintWhyEl: HTMLElement | null = null;
private lastCoachPly = -1;
private lastFen = "";
```

- [ ] **Step 4: Remove coach DOM nodes from `mount()`**

In `mount()`, find and make these three changes:

**4a.** Change the board slot class (remove `--coach` modifier):
```ts
// BEFORE:
const boardSlot = el("div", "game-board-slot game-board-slot--coach");
// AFTER:
const boardSlot = el("div", "game-board-slot");
```

**4b.** Remove the eval bar append (the line right after `boardSlot.appendChild(this.board.el)`):
```ts
// DELETE this line:
boardSlot.appendChild(this.evalBar.el);
```

**4c.** Remove the coach banner and hint-why nodes (inside `statusWrap` setup, after `statusWrap.appendChild(this.statusEl)`):
```ts
// DELETE these lines:
// Coach banner container (hidden initially)
this.coachBannerEl = el("div", "");
statusWrap.appendChild(this.coachBannerEl);
// Hint-why line
this.hintWhyEl = el("div", "hint-why");
this.hintWhyEl.hidden = true;
statusWrap.appendChild(this.hintWhyEl);
```

- [ ] **Step 5: Remove coach calls from `destroy()` and `update()`**

In `destroy()`, delete:
```ts
// DELETE this line:
this.coach.dispose();
```

In `update()`, delete:
```ts
// DELETE these two lines:
this.updateLiveCoach();
this.updateCoach();
```

- [ ] **Step 6: Delete `updateLiveCoach()` and `updateCoach()` methods**

Delete the entire `updateLiveCoach()` method (~30 lines, starting with `private updateLiveCoach(): void {`).

Delete the entire `updateCoach()` method (~40 lines, starting with `private updateCoach(): void {`).

- [ ] **Step 7: Remove coach toggle from `settingsPanel.ts`**

Remove the import line:
```ts
// DELETE:
import { loadCoachEnabled, saveCoachEnabled } from "../coach/coachSettings";
```

Remove the coach label block inside `openSettingsPanel()` (six lines):
```ts
// DELETE these lines:
const coachLabel = document.createElement("label");
coachLabel.className = "coach-setting";
const coachToggle = document.createElement("input");
coachToggle.type = "checkbox";
coachToggle.checked = loadCoachEnabled();
coachToggle.onchange = () => saveCoachEnabled(coachToggle.checked);
coachLabel.appendChild(coachToggle);
coachLabel.appendChild(document.createTextNode("Coach (eval bar + blunder warnings)"));
panel.appendChild(coachLabel);
```

- [ ] **Step 8: Remove coach CSS from `styles.css`**

Delete the entire "Coach UI" section. It starts at the comment on line 1317 and runs through the `.coach-setting` block. The block immediately after (`.coach-badge` at line 1444) must be kept.

Delete from `/* ---- Coach UI ---- */` through the closing `}` of `.coach-setting`:

```css
/* DELETE from here: */

/* ---- Coach UI ---- */

/* Eval bar: slim vertical track beside the board */
.game-board-slot--coach {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 6px;
}

.eval-bar { … }
.eval-bar.hidden { … }
.eval-bar-fill { … }
.eval-bar-label { … }

/* Coach banner: dismissible toast below status bar */
.coach-banner { … }
.coach-banner--mistake { … }
.coach-banner--blunder { … }
.coach-banner-dot { … }
.coach-banner--mistake .coach-banner-dot { … }
.coach-banner--blunder .coach-banner-dot { … }
.coach-banner-text { … }
.coach-banner-dismiss { … }
.coach-banner-dismiss:hover { … }

/* Hint why: small caption under hint button area */
.hint-why { … }

/* Settings coach toggle */
.coach-setting { … }

/* DELETE to here — stop before .coach-badge */
```

The `.coach-badge`, `.coach-progress`, `.coach-accuracy`, `.coach-moments` rules that follow must be kept — they serve the post-game review panel.

- [ ] **Step 9: Run tests and build**

```bash
cd web && npm test
```
Expected: all tests pass (the deleted test files are gone so they won't run; remaining tests — classify, analyzeClient, review, gameHistory, etc. — must all pass).

```bash
cd web && npm run build
```
Expected: exits 0 with no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add web/src/coach/liveCoach.ts web/src/coach/liveCoach.test.ts \
        web/src/ui/evalBar.ts \
        web/src/coach/coachSettings.ts web/src/coach/coachSettings.test.ts \
        web/src/coach/explain.ts web/src/coach/explain.test.ts \
        web/src/ui/gameView.ts web/src/ui/settingsPanel.ts \
        web/src/styles.css
git commit -m "Remove live coach: eval bar, blunder banners, coach toggle"
```

---

## Task 2: Fix board highlight subpixel glitch

**Files:**
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: nothing
- Produces: `.board-grid` with `background-color` set, eliminating hairline gap artifacts

- [ ] **Step 1: Add background-color to `.board-grid`**

Find the `.board-grid` rule in `styles.css` (around line 438) and add one property:

```css
.board-grid {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  grid-template-rows: repeat(10, 1fr);
  width: 100%;
  height: 100%;
  gap: 0;
  border-radius: 0;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.45);
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  background-color: var(--dark-square); /* fills subpixel gaps between cells */
}
```

- [ ] **Step 2: Build and commit**

```bash
cd web && npm test && npm run build
```
Expected: exits 0.

```bash
git add web/src/styles.css
git commit -m "Fix board highlight subpixel gaps: set board-grid background to dark square colour"
```

---

## Task 3: Landing page — Fairy Stockfish explanation + iPhone link new tab

**Files:**
- Modify: `web/index.html` (the static `/` landing page — not `web/play/index.html`)

**Interfaces:**
- Consumes: nothing
- Produces: updated hero sub-text and App Store links with `target="_blank"`

- [ ] **Step 1: Add Fairy Stockfish explanation**

Find the hero `<p class="sub">` element. It currently reads:

```html
<p class="sub">Classic FIDE rules on an inner 8×8, plus a one-square border you can step onto. Play in your browser: pass-and-play or vs Fairy-Stockfish. Now on iPhone, too.</p>
```

Change it to:

```html
<p class="sub">Classic FIDE rules on an inner 8×8, plus a one-square border you can step onto. Play in your browser: pass-and-play or vs Fairy-Stockfish (a powerful open-source chess engine that supports non-standard board variants). Now on iPhone, too.</p>
```

- [ ] **Step 2: Open iPhone links in a new tab**

There are two App Store links. Add `target="_blank" rel="noopener"` to both.

**Hero CTA button** — find:
```html
<a class="btn btn-ghost" href="https://apps.apple.com/app/border-chess/id6774101655">Get it on iPhone</a>
```
Change to:
```html
<a class="btn btn-ghost" href="https://apps.apple.com/app/border-chess/id6774101655" target="_blank" rel="noopener">Get it on iPhone</a>
```

**"Now on iPhone" card** — find:
```html
<a href="https://apps.apple.com/app/border-chess/id6774101655">Download it for iPhone</a>
```
Change to:
```html
<a href="https://apps.apple.com/app/border-chess/id6774101655" target="_blank" rel="noopener">Download it for iPhone</a>
```

- [ ] **Step 3: Build and commit**

```bash
cd web && npm test && npm run build
```
Expected: exits 0.

```bash
git add web/index.html
git commit -m "Landing page: explain Fairy Stockfish; open App Store links in new tab"
```

---

## Task 4: Session persistence — Resume button + navigation guards

**Files:**
- Modify: `web/src/ui/home.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/ui/gameView.ts`

**Interfaces:**
- Consumes: `loadSavedGame()` from `../game/savedGame` (already imported in `main.ts`)
- Produces:
  - `renderHome(root, onStart, onPlayOnline, onPastGames, onLeaderboard, onResume?)` — new optional sixth parameter
  - Back button in `GameScreen` confirms before leaving an ongoing game
  - `popstate` handler confirms before leaving any active game screen

- [ ] **Step 1: Add `onResume` parameter to `renderHome` in `home.ts`**

Change the function signature (add `onResume?: () => void` as the sixth parameter):

```ts
export function renderHome(
  root: HTMLElement,
  onStart: (opts: HomeStart) => void,
  onPlayOnline: (roomId?: string) => void,
  onPastGames: () => void = () => {},
  onLeaderboard: () => void = () => {},
  onResume?: () => void
): void {
```

Inside `render()`, add the Resume button as the first item in `actions`, right after `const actions = el("div", "home-actions");`:

```ts
const actions = el("div", "home-actions");

if (onResume) {
  const resumeBtn = el("button", "primary", "Resume Game");
  resumeBtn.onclick = onResume;
  actions.appendChild(resumeBtn);
}
```

- [ ] **Step 2: Pass `onResume` from `showHome()` in `main.ts`**

At the top of `main.ts`, `loadSavedGame` is already imported. Update `showHome()` to compute `onResume` and pass it:

```ts
function showHome(): void {
  teardownGame?.();
  teardownGame = undefined;
  const url = new URL(location.href);
  if (url.searchParams.has("room")) {
    url.searchParams.delete("room");
    history.replaceState(null, "", url.toString());
  }
  if (currentRoute() !== "home") {
    history.pushState(null, "", "/play/");
  }

  const saved = loadSavedGame();
  const onResume = saved
    ? () => {
        void import("./ui/gameView")
          .then(({ renderGame }) => {
            teardownGame?.();
            teardownGame = renderGame(app, saved.mode, saved.botDifficulty, showHome, saved);
          })
          .catch((err: unknown) => {
            console.error(err);
            showBootError("Could not resume the game. Try reloading the page.");
          });
      }
    : undefined;

  renderHome(app, startGame, (roomId) => startOnline(roomId ?? newRoomId()), showPastGames, showLeaderboard, onResume);
}
```

- [ ] **Step 3: Add popstate guard in `main.ts`**

Replace the existing `popstate` handler:

```ts
// BEFORE:
window.addEventListener("popstate", () => {
  const route = currentRoute();
  if (route === "leaderboard") { showLeaderboard(); return; }
  if (route === "past-games") { showPastGames(); return; }
  showHome();
});

// AFTER:
window.addEventListener("popstate", () => {
  if (teardownGame !== undefined) {
    if (!confirm("Leave game? Your progress is saved — tap Resume on the home screen to continue.")) {
      history.pushState(null, "", location.href);
      return;
    }
  }
  const route = currentRoute();
  if (route === "leaderboard") { showLeaderboard(); return; }
  if (route === "past-games") { showPastGames(); return; }
  showHome();
});
```

- [ ] **Step 4: Add back-button guard in `gameView.ts`**

In `GameScreen.mount()`, find the back button handler and add the ongoing-game check:

```ts
// BEFORE:
back.onclick = () => this.onBack();

// AFTER:
back.onclick = () => {
  if (!this.replay && this.ctrl.game.result.type === "ongoing") {
    if (!confirm("Leave game? Your progress is saved — tap Resume on the home screen to continue.")) return;
  }
  this.onBack();
};
```

- [ ] **Step 5: Run tests and build**

```bash
cd web && npm test && npm run build
```
Expected: exits 0. TypeScript will catch any signature mismatches in the `renderHome` call.

- [ ] **Step 6: Commit**

```bash
git add web/src/ui/home.ts web/src/main.ts web/src/ui/gameView.ts
git commit -m "Session persistence: Resume button on home, confirm before leaving active game"
```

---

## Task 5: "Back to live" banner + prominent Live button

**Files:**
- Modify: `web/src/ui/gameView.ts`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `ctrl.previewPly` (already available on `GameController`), `ctrl.returnToLive()` (already available)
- Produces: contextual banner visible when `previewPly !== null` in a live game; Live button styled `primary` when in history

- [ ] **Step 1: Add `historyBannerEl` field to `GameScreen`**

Add the field with the other private fields near the top of the class:

```ts
private historyBannerEl: HTMLElement | null = null;
```

- [ ] **Step 2: Mount the banner in `mount()`**

Inside `mount()`, after `statusWrap.appendChild(this.statusEl)` and before `top.appendChild(statusWrap)`, add:

```ts
if (!this.replay) {
  this.historyBannerEl = el("div", "history-banner");
  this.historyBannerEl.hidden = true;
  statusWrap.appendChild(this.historyBannerEl);
}
```

- [ ] **Step 3: Add `updateHistoryBanner()` method**

Add this method to `GameScreen` (place it near `updateControls`):

```ts
private updateHistoryBanner(): void {
  if (!this.historyBannerEl || this.replay) return;
  const ply = this.ctrl.previewPly;
  this.historyBannerEl.hidden = ply === null;
  if (ply !== null) {
    this.historyBannerEl.replaceChildren();
    const text = el("span", "history-banner-text", `Viewing move ${ply}`);
    const btn = el("button", "primary history-banner-live", "Live ▶") as HTMLButtonElement;
    btn.onclick = () => this.ctrl.returnToLive();
    this.historyBannerEl.appendChild(text);
    this.historyBannerEl.appendChild(btn);
  }
}
```

- [ ] **Step 4: Call `updateHistoryBanner()` from `update()`**

Add the call at the end of `update()` alongside the other update calls:

```ts
private update(): void {
  if (!this.mounted) return;
  // … existing calls …
  this.updateHistoryBanner();
}
```

- [ ] **Step 5: Style the Live button `primary` when in history**

In `updateControls()`, in the non-replay branch, after `this.liveBtn.disabled = this.ctrl.previewPly == null;`, add:

```ts
this.liveBtn.classList.toggle("primary", this.ctrl.previewPly !== null);
```

The full non-replay section of `updateControls()` should now end with:

```ts
const gameOver = this.ctrl.game.result.type !== "ongoing";
this.undoBtn.disabled = gameOver || this.ctrl.game.moveHistory.length === 0;
this.resignBtn.disabled = gameOver;
this.retryBtn.hidden = !this.ctrl.canRetryBot;
this.retryBtn.disabled = !this.ctrl.canRetryBot;
this.liveBtn.disabled = this.ctrl.previewPly == null;
this.liveBtn.classList.toggle("primary", this.ctrl.previewPly !== null);
```

- [ ] **Step 6: Add `.history-banner` CSS to `styles.css`**

Append after the existing `.coach-review-container` rule (or at the end of the game-screen section):

```css
/* History review banner: shown when browsing past moves in a live game */
.history-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--accent) 15%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 8px;
  margin-top: 4px;
  font-size: 0.85rem;
  color: var(--text);
}

.history-banner-text {
  color: var(--muted);
}

.history-banner-live {
  padding: 4px 10px;
  font-size: 0.8rem;
}
```

- [ ] **Step 7: Run tests and build**

```bash
cd web && npm test && npm run build
```
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add web/src/ui/gameView.ts web/src/styles.css
git commit -m "Add history-review banner and prominent Live button when browsing past moves"
```
