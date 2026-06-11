import { type BotDifficulty, difficultyElo } from "../engine/types";
import { roomIdFromInput } from "../online/guestIdentity";
import { createSettingsButton } from "./settingsPanel";
import { createAuthWidget } from "../auth/authWidget";

const LOGO_SRC =
  (import.meta.env.VITE_LOGO_CDN_URL as string | undefined) ??
  (import.meta.env.DEV
    ? `${import.meta.env.BASE_URL}logo_v2.png`
    : "/logo_v2.png");

export type HomeStart = {
  mode: "vsBot" | "localTwoPlayer";
  difficulty: BotDifficulty;
};

export function renderHome(
  root: HTMLElement,
  onStart: (opts: HomeStart) => void,
  onPlayOnline: (roomId?: string) => void,
  onPastGames: () => void = () => {},
  onLeaderboard: () => void = () => {}
): void {
  let difficulty: BotDifficulty = "medium";

  const render = () => {
    root.innerHTML = "";
    const home = el("div", "home");

    const logo = document.createElement("img");
    logo.className = "home-logo";
    logo.src = LOGO_SRC;
    logo.alt = "Border Chess";
    logo.width = 1024;
    logo.height = 1024;
    home.appendChild(logo);

    home.appendChild(el("h1", "", "Border Chess"));
    home.appendChild(
      el(
        "p",
        "tagline",
        "10×10 border chess. Play vs bot or pass-and-play with a friend."
      )
    );

    const diff = el("div", "difficulty-picker");
    for (const level of ["easy", "medium", "hard"] as BotDifficulty[]) {
      const btn = el("button", level === difficulty ? "active" : "", level[0].toUpperCase() + level.slice(1));
      btn.onclick = () => {
        difficulty = level;
        render();
      };
      diff.appendChild(btn);
    }
    home.appendChild(diff);

    home.appendChild(el("p", "elo-note", `Bot strength ≈ ${difficultyElo(difficulty)} ELO`));

    const actions = el("div", "home-actions");
    const botBtn = el("button", "primary", "Play vs Bot");
    botBtn.onclick = () => onStart({ mode: "vsBot", difficulty });
    actions.appendChild(botBtn);

    const friendBtn = el("button", "", "Play with Friend");
    friendBtn.onclick = () => onStart({ mode: "localTwoPlayer", difficulty });
    actions.appendChild(friendBtn);

    const onlineBtn = el("button", "", "Play Online");
    onlineBtn.onclick = () => onPlayOnline();
    actions.appendChild(onlineBtn);

    const joinRow = el("div", "join-row");
    const joinInput = document.createElement("input");
    joinInput.type = "text";
    joinInput.className = "join-input";
    joinInput.placeholder = "Enter room code or link";
    joinInput.autocapitalize = "none";
    joinInput.autocomplete = "off";
    const joinBtn = el("button", "", "Join") as HTMLButtonElement;
    const doJoin = () => {
      const code = roomIdFromInput(joinInput.value);
      if (code) onPlayOnline(code);
    };
    joinBtn.onclick = doJoin;
    joinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doJoin();
    });
    joinRow.appendChild(joinInput);
    joinRow.appendChild(joinBtn);
    actions.appendChild(joinRow);

    const pastGamesBtn = el("button", "", "Past Games");
    pastGamesBtn.onclick = () => onPastGames();
    actions.appendChild(pastGamesBtn);

    const leaderboardBtn = el("button", "", "Leaderboard");
    leaderboardBtn.onclick = () => onLeaderboard();
    actions.appendChild(leaderboardBtn);

    home.appendChild(actions);

    const gear = createSettingsButton();
    gear.classList.add("home-settings");
    home.appendChild(gear);

    const auth = createAuthWidget();
    if (auth) home.appendChild(auth);

    root.appendChild(home);
  };

  render();
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
