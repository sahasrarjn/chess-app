import "./styles.css";
import { renderGame } from "./ui/gameView";
import { renderHome, type HomeStart } from "./ui/home";

const app = document.getElementById("app")!;
if (!app) throw new Error("#app not found");

let teardownGame: (() => void) | undefined;

function showHome(): void {
  teardownGame?.();
  teardownGame = undefined;
  renderHome(app, (opts: HomeStart) => {
    teardownGame = renderGame(app, opts.mode, opts.difficulty, showHome);
  });
}

showHome();
