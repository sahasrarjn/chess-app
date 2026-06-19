# Border Chess — Cleanup & UX Fixes Design

**Date:** 2026-06-20  
**Status:** Approved

## Scope

Five independent areas of work, ordered from most to least invasive.

---

## 1. Remove live coach

### What is removed

| File | Action |
|------|--------|
| `web/src/coach/liveCoach.ts` | Delete |
| `web/src/coach/liveCoach.test.ts` | Delete |
| `web/src/ui/evalBar.ts` | Delete |
| `web/src/coach/coachSettings.ts` | Delete |
| `web/src/coach/coachSettings.test.ts` | Delete |
| `web/src/coach/explain.ts` | Delete |
| `web/src/coach/explain.test.ts` | Delete |

### Changes to `gameView.ts`

Remove all coach fields from `GameScreen`:
- `coach` (`LiveCoach` instance)
- `evalBar` (`EvalBar` instance)
- `coachBannerEl`
- `hintWhyEl`
- `lastCoachPly`
- `lastFen`

Remove methods:
- `updateLiveCoach()`
- `updateCoach()`

Remove from `mount()`:
- The `boardSlot` class `game-board-slot--coach`
- `this.evalBar.el` appended to boardSlot
- `coachBannerEl` and `hintWhyEl` DOM nodes in statusWrap

Remove from `destroy()`:
- `this.coach.dispose()`

Remove from `update()`:
- Calls to `updateLiveCoach()` and `updateCoach()`

### Changes to `settingsPanel.ts`

Remove the entire coach label/checkbox block:
- `coachLabel`, `coachToggle` creation and `panel.appendChild(coachLabel)`
- Import of `loadCoachEnabled` / `saveCoachEnabled`

### CSS removals (keep review/badge rules)

Remove:
- `.coach-setting` and its rules
- `.coach-banner`, `.coach-banner--*`, `.coach-banner-dot`, `.coach-banner-text`, `.coach-banner-dismiss`
- Eval bar rules (`.eval-bar`, `.eval-bar-fill`, etc.)

Keep (used by post-game review):
- `.coach-badge`, `.coach-badge--*`
- `.coach-progress`, `.coach-progress-track`, `.coach-progress-fill`, `.coach-progress-row`, `.coach-progress-label`
- `.coach-accuracy`, `.coach-moments`, `.coach-moment-row`, `.coach-moment-*`
- `.coach-review-container`

### What stays

- `review.ts` + `review.test.ts` — post-game Analyze Game flow
- `classify.ts` + `classify.test.ts` — move classification for review badges
- `analyzeClient.ts` + `analyzeClient.test.ts` — engine analysis used by review
- Hint button in the game header
- `startReview()`, `cancelReview()`, `updateReview()` in `gameView.ts`
- All move-list classification badge rendering in `moveListView.ts`

---

## 2. Landing page fixes

Both changes are in `web/index.html` (the static `/` landing page, not the `/play/` app).

### Fairy Stockfish explanation

In the hero sub-paragraph, append a parenthetical after "Fairy-Stockfish":

**Before:**
```
…pass-and-play or vs Fairy-Stockfish.
```

**After:**
```
…pass-and-play or vs Fairy-Stockfish (a powerful open-source chess engine that supports non-standard board variants).
```

### iPhone link opens in new tab

Add `target="_blank" rel="noopener"` to both App Store `<a>` tags (one in the hero CTA, one in the "Now on iPhone" card).

---

## 3. Session persistence — robust save/restore

The game is already saved on every move via `maybePersist()`. The fixes are in the navigation layer only.

### Home screen — Resume button

`renderHome()` in `home.ts` gains an optional `onResume?: () => void` parameter.

At call sites in `main.ts`:
- Check `loadSavedGame()` and whether the saved game's result is `"ongoing"`
- If so, pass an `onResume` callback that calls the existing restore path (same as page-load restore)

In `renderHome()`:
- When `onResume` is provided, render a **"Resume Game"** button as the first button in `home-actions`, above "Play vs Bot"
- Style it as `primary` so it's visually distinct

### "← Back" guard during active game

In `GameScreen.mount()`, the back button handler becomes:

```
back.onclick = () => {
  if (this.ctrl.game.result.type === "ongoing") {
    if (!confirm("Leave game? Your progress is saved — tap Resume on the home screen to continue.")) return;
  }
  this.onBack();
};
```

No confirmation is shown when the game is already over (result ≠ `"ongoing"`).

### Browser back button (popstate) guard

In `main.ts`, the `popstate` handler checks whether a game is active before navigating:

```
window.addEventListener("popstate", () => {
  if (activeGameIsOngoing()) {
    if (!confirm("Leave game? Your progress is saved — tap Resume on the home screen to continue.")) {
      history.pushState(null, "", location.href); // re-push to undo navigation
      return;
    }
  }
  const route = currentRoute();
  if (route === "leaderboard") { showLeaderboard(); return; }
  if (route === "past-games") { showPastGames(); return; }
  showHome();
});
```

`activeGameIsOngoing()` is a small helper that inspects the current `teardownGame` state — the simplest approach is a module-level `let currentGameOngoing = false` flag kept in sync when games start/end.

### Starting a new game from home

No extra confirmation needed. The Resume button gives users an explicit "continue" path; clicking "Play vs Bot" is a deliberate choice to start fresh. The save is overwritten naturally on the first move of the new game.

---

## 4. "Back to live" banner

### When it appears

Only during an **active game** (not replay), when `ctrl.previewPly !== null`.

### Markup

A `div.history-banner` is inserted between the status bar and the board (inside `statusWrap`). It is hidden by default and toggled in `updateControls()`.

Content:
```
Viewing move {N}  [Live ▶]
```

Where `{N}` is `ctrl.previewPly` (updated on every `update()` call). The `[Live ▶]` button calls `ctrl.returnToLive()`.

### "Live" button prominence

The existing "Live" button in the controls row gets class `primary` added when `ctrl.previewPly !== null`, and reverts to the default style when at live position. This gives two affordances: the banner above the board and the highlighted button in the controls.

### Dismissal

The banner disappears automatically when `ctrl.previewPly` returns to `null` (i.e. the user navigated back to the live position via any path — banner button, controls "Live" button, clicking the last move in the move list, etc.).

---

## 5. Board highlighting glitch

### Root cause

CSS Grid distributes `1fr` widths fractionally. When the board pixel width is not exactly divisible by 10, cells get rounded to different pixel sizes, leaving hairline gaps where the element behind the grid bleeds through as a lighter strip.

### Fix

Add `background-color: var(--dark-square)` to `.board-grid`. Gaps then show the dark square colour, which is visually indistinguishable from the adjacent dark squares.

```css
.board-grid {
  /* existing rules … */
  background-color: var(--dark-square);
}
```

One line. No layout or behaviour changes.

---

## Out of scope

- Coach tooltip / settings explanation (coach is being removed)
- Any multiplayer / online changes
- iOS / Mac app
