import "./styles.css";
import { loadSavedGame } from "./game/savedGame";
import { renderHome, type HomeStart } from "./ui/home";

void import("./analytics/posthog").then(({ initAnalytics }) => initAnalytics());

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

  function showHome(): void {
    teardownGame?.();
    teardownGame = undefined;
    renderHome(app, startGame);
  }

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
} catch (err: unknown) {
  console.error(err);
  showBootError("Border Chess failed to load. Try reloading the page.");
}
