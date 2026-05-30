import { checkEngineHealth } from "../bot/remoteEngine";
import {
  getEngineUrl,
  isEngineConfigured,
  setEngineUrl,
} from "../bot/engineConfig";
import type { BotDifficulty } from "../engine/types";

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
  onStart: (opts: HomeStart) => void
): void {
  let difficulty: BotDifficulty = "medium";
  let settingsOpen = false;

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
        "10×10 border chess. Play vs bot or pass-and-play with a friend. Same rules as the iOS app."
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

    const actions = el("div", "home-actions");
    const botBtn = el("button", "primary", "Play vs Bot");
    botBtn.onclick = () => onStart({ mode: "vsBot", difficulty });
    actions.appendChild(botBtn);

    const friendBtn = el("button", "", "Play with Friend");
    friendBtn.onclick = () => onStart({ mode: "localTwoPlayer", difficulty });
    actions.appendChild(friendBtn);

    home.appendChild(actions);

    const settingsBtn = el(
      "button",
      "settings-toggle",
      settingsOpen ? "Hide engine settings" : "Engine settings (for bot)"
    );
    settingsBtn.onclick = () => {
      settingsOpen = !settingsOpen;
      render();
    };
    home.appendChild(settingsBtn);

    if (settingsOpen) {
      const panel = el("div", "settings-panel");
      panel.appendChild(el("label", "", "Engine server URL (local dev only)"));
      const urlInput = document.createElement("input");
      urlInput.type = "url";
      urlInput.placeholder = "Leave empty. Production uses this site automatically";
      urlInput.value = getEngineUrl();
      panel.appendChild(urlInput);

      panel.appendChild(
        el(
          "p",
          "engine-status",
          "Production bot traffic goes through this site. No API key is needed in the browser."
        )
      );

      const saveBtn = el("button", "", "Save");
      saveBtn.onclick = () => {
        setEngineUrl(urlInput.value);
        updateEngineStatus(statusEl);
      };
      panel.appendChild(saveBtn);

      const statusEl = el("p", "engine-status", "Checking engine…");
      panel.appendChild(statusEl);
      home.appendChild(panel);
      updateEngineStatus(statusEl);
    } else if (!isEngineConfigured()) {
      home.appendChild(
        el(
          "p",
          "engine-status",
          "Bot uses this site’s /v1/move API. Leave engine URL empty on web."
        )
      );
    }

    root.appendChild(home);
  };

  render();
}

async function updateEngineStatus(el: HTMLElement): Promise<void> {
  el.textContent = "Checking engine…";
  el.className = "engine-status";
  try {
    const ok = await checkEngineHealth();
    if (ok) {
      el.textContent = "Engine connected";
      el.className = "engine-status ok";
    } else {
      el.textContent = "Engine not reachable. Start docker compose in server/";
      el.className = "engine-status err";
    }
  } catch {
    el.textContent = "Engine not reachable. Start docker compose in server/";
    el.className = "engine-status err";
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
