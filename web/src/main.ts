import "./styles.css";
import { applyBoardTheme, boardThemeById, loadBoardThemeId } from "./theme/boardThemes";
import { loadSavedGame } from "./game/savedGame";
import { renderHome, type HomeStart } from "./ui/home";
import { newRoomId } from "./online/guestIdentity";
import type { CompletedGameRecord } from "./game/gameHistory";

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

  function showReplay(record: CompletedGameRecord): void {
    void import("./ui/gameView")
      .then(({ renderReplay }) => {
        teardownGame?.();
        teardownGame = renderReplay(app, record, showPastGames);
      })
      .catch((err: unknown) => {
        console.error(err);
        showBootError("Could not open the replay. Try reloading the page.");
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
    renderHome(app, startGame, (roomId) => startOnline(roomId ?? newRoomId()), showPastGames);
  }

  const roomParam = new URLSearchParams(location.search).get("room");
  if (roomParam) {
    startOnline(roomParam);
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
} catch (err: unknown) {
  console.error(err);
  showBootError("Border Chess failed to load. Try reloading the page.");
}
