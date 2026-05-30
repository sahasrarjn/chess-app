import "./styles.css";
import { initAnalytics } from "./analytics/posthog";
import { loadSavedGame } from "./game/savedGame";
import { renderGame } from "./ui/gameView";
import { renderHome, type HomeStart } from "./ui/home";

initAnalytics();

const app = document.getElementById("app")!;
if (!app) throw new Error("#app not found");

let teardownGame: (() => void) | undefined;

function showHome(): void {
  teardownGame?.();
  teardownGame = undefined;
  renderHome(app, (opts: HomeStart) => {
    teardownGame?.();
    teardownGame = renderGame(app, opts.mode, opts.difficulty, showHome);
  });
}

const saved = loadSavedGame();
if (saved) {
  teardownGame = renderGame(app, saved.mode, saved.botDifficulty, showHome, saved);
} else {
  showHome();
}
