import {
  BOARD_THEMES,
  applyBoardTheme,
  loadBoardThemeId,
  saveBoardThemeId,
} from "../theme/boardThemes";
import { loadCoachEnabled, saveCoachEnabled } from "../coach/coachSettings";

const GEAR_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z"></path></svg>`;

let openOverlay: HTMLElement | null = null;
let onEscape: ((e: KeyboardEvent) => void) | null = null;

export function closeSettingsPanel(): void {
  openOverlay?.remove();
  openOverlay = null;
  if (onEscape) {
    document.removeEventListener("keydown", onEscape);
    onEscape = null;
  }
}

export function openSettingsPanel(): void {
  if (openOverlay) return;
  const overlay = document.createElement("div");
  overlay.className = "settings-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) closeSettingsPanel();
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

  const coachLabel = document.createElement("label");
  coachLabel.className = "coach-setting";
  const coachToggle = document.createElement("input");
  coachToggle.type = "checkbox";
  coachToggle.checked = loadCoachEnabled();
  coachToggle.onchange = () => saveCoachEnabled(coachToggle.checked);
  coachLabel.appendChild(coachToggle);
  coachLabel.appendChild(document.createTextNode("Coach (eval bar + blunder warnings)"));
  panel.appendChild(coachLabel);

  const done = document.createElement("button");
  done.type = "button";
  done.className = "primary";
  done.textContent = "Done";
  done.onclick = closeSettingsPanel;
  panel.appendChild(done);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  openOverlay = overlay;
  onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeSettingsPanel();
  };
  document.addEventListener("keydown", onEscape);
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
