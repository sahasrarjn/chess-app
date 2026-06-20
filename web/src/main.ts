import "./styles.css";
import { applyBoardTheme, boardThemeById, loadBoardThemeId } from "./theme/boardThemes";
import { loadSavedGame } from "./game/savedGame";
import { renderHome, type HomeStart } from "./ui/home";
import { newRoomId } from "./online/guestIdentity";
import type { CompletedGameRecord } from "./game/gameHistory";
import { hasChosenGuestThisSession } from "./ui/signInView";
import { getSessionToken } from "./auth/session";
import { isAuthConfigured } from "./auth/config";

applyBoardTheme(boardThemeById(loadBoardThemeId()));

void import("./analytics/posthog").then(({ initAnalytics }) => initAnalytics());
void import("./game/gameUploads").then(({ flushPendingUploads }) => flushPendingUploads());

function showBootError(message: string): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = "";
  const panel = document.createElement("div");
  panel.className = "boot-error";
  const text = document.createElement("p");
  text.textContent = message;
  panel.appendChild(text);
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.onclick = () => location.reload();
  panel.appendChild(reload);
  app.appendChild(panel);
}

function clearBootShell(): void {
  document.getElementById("boot-loading")?.remove();
}

// Top-level routes (/leaderboard, /past-games) and the legacy /play/ base all load
// the same bundle. Read the pathname to decide what to render first.
function currentRoute(): "leaderboard" | "past-games" | "home" {
  const path = location.pathname.replace(/\/+$/, "");
  if (path === "/leaderboard") return "leaderboard";
  if (path === "/past-games") return "past-games";
  return "home";
}

try {
  const appEl = document.getElementById("app");
  if (!appEl) throw new Error("#app not found");
  const app = appEl;
  clearBootShell();

  let teardownGame: (() => void) | undefined;

  function startGame(opts: HomeStart): void {
    void import("./ui/gameView")
      .then(({ renderGame }) => {
        teardownGame?.();
        teardownGame = renderGame(app, opts.mode, opts.difficulty, showHome);
      })
      .catch((err: unknown) => {
        console.error(err);
        showBootError("Could not start the game. Try reloading the page.");
      });
  }

  function startOnline(roomId: string): void {
    const url = new URL(location.href);
    url.searchParams.set("room", roomId);
    history.replaceState(null, "", url.toString());
    void import("./ui/onlineGameView")
      .then(({ renderOnlineGame }) => {
        teardownGame?.();
        teardownGame = renderOnlineGame(app, roomId, showHome);
      })
      .catch((err: unknown) => {
        console.error(err);
        showBootError("Could not start the online game. Try reloading the page.");
      });
  }

  function showPastGames(): void {
    history.pushState(null, "", "/past-games");
    void import("./ui/pastGamesView")
      .then(({ renderPastGames }) => {
        teardownGame?.();
        teardownGame = renderPastGames(app, showHome, showReplay);
      })
      .catch((err: unknown) => {
        console.error(err);
        showBootError("Could not load Past Games. Try reloading the page.");
      });
  }

  function showLeaderboard(): void {
    history.pushState(null, "", "/leaderboard");
    void import("./ui/leaderboardView")
      .then(({ renderLeaderboard }) => {
        teardownGame?.();
        teardownGame = renderLeaderboard(app, showHome);
      })
      .catch((err: unknown) => {
        console.error(err);
        showBootError("Could not load the Leaderboard. Try reloading the page.");
      });
  }

  function showReplay(record: CompletedGameRecord): void {
    void import("./ui/gameView")
      .then(({ renderReplay }) => {
        teardownGame?.();
        teardownGame = renderReplay(app, record, showPastGames, { review: true });
      })
      .catch((err: unknown) => {
        console.error(err);
        showBootError("Could not open the replay. Try reloading the page.");
      });
  }

  function needsSignIn(): boolean {
    if (!isAuthConfigured) return false;           // auth not set up → skip
    if (getSessionToken()) return false;            // already signed in
    if (hasChosenGuestThisSession()) return false;  // chose guest this session
    return true;
  }

  function showSignIn(): void {
    teardownGame?.();
    teardownGame = undefined;
    if (currentRoute() !== "home") history.pushState(null, "", "/play/");
    void import("./ui/signInView").then(({ renderSignIn }) => {
      teardownGame = renderSignIn(app, showHome, showHome);
    });
  }

  function showHome(): void {
    teardownGame?.();
    teardownGame = undefined;
    const url = new URL(location.href);
    if (url.searchParams.has("room")) {
      url.searchParams.delete("room");
      history.replaceState(null, "", url.toString());
    }
    // Navigate to /play/ when going home from a top-level route
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

  // Handle browser back/forward
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

  // Initial render based on the current URL path
  const route = currentRoute();
  if (route === "leaderboard") {
    showLeaderboard();
  } else if (route === "past-games") {
    showPastGames();
  } else {
    const roomParam = new URLSearchParams(location.search).get("room");
    if (roomParam) {
      startOnline(roomParam);
    } else if (needsSignIn()) {
      showSignIn();
    } else {
      const saved = loadSavedGame();
      if (saved) {
        void import("./ui/gameView")
          .then(({ renderGame }) => {
            teardownGame = renderGame(app, saved.mode, saved.botDifficulty, showHome, saved);
          })
          .catch((err: unknown) => {
            console.error(err);
            showHome();
          });
      } else {
        showHome();
      }
    }
  }
} catch (err: unknown) {
  console.error(err);
  showBootError("Border Chess failed to load. Try reloading the page.");
}
