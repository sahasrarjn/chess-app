export type BoardThemeId =
  | "classic"
  | "walnut"
  | "ocean"
  | "slate"
  | "tournament"
  | "high-contrast"
  | "rosewood"
  | "blossom";

export interface BoardThemePreset {
  id: BoardThemeId;
  name: string;
  lightSquare: string;
  darkSquare: string;
  legalDot?: string;
}

export const BOARD_THEMES: readonly BoardThemePreset[] = [
  { id: "classic", name: "Classic Green", lightSquare: "#eeeed1", darkSquare: "#769656" },
  { id: "walnut", name: "Walnut", lightSquare: "#f0d9b5", darkSquare: "#b58863" },
  { id: "ocean", name: "Ocean", lightSquare: "#e3ecf2", darkSquare: "#6e98b5" },
  { id: "slate", name: "Slate", lightSquare: "#e4e6e9", darkSquare: "#7d848d" },
  { id: "tournament", name: "Tournament", lightSquare: "#ffce9e", darkSquare: "#d18b47" },
  { id: "high-contrast", name: "High Contrast", lightSquare: "#ffffff", darkSquare: "#444444", legalDot: "rgba(140, 140, 140, 0.55)" },
  { id: "rosewood", name: "Rosewood", lightSquare: "#f1dcd6", darkSquare: "#a8716e" },
  { id: "blossom", name: "Blossom", lightSquare: "#fbeef2", darkSquare: "#d98ea4" },
];

export const DEFAULT_BOARD_THEME_ID: BoardThemeId = "classic";

const STORAGE_KEY = "chessborder.boardTheme";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function boardThemeById(id: string | null | undefined): BoardThemePreset {
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
}

export function loadBoardThemeId(storage: ThemeStorage = localStorage): BoardThemeId {
  try {
    return boardThemeById(storage.getItem(STORAGE_KEY)).id;
  } catch {
    return DEFAULT_BOARD_THEME_ID;
  }
}

export function saveBoardThemeId(id: BoardThemeId, storage: ThemeStorage = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing or storage denied: theme just won't persist.
  }
}

type StylableRoot = { style: Pick<CSSStyleDeclaration, "setProperty"> };

const DEFAULT_LEGAL_DOT = "rgba(30, 30, 30, 0.28)";

export function applyBoardTheme(
  theme: BoardThemePreset,
  root: StylableRoot = document.documentElement
): void {
  root.style.setProperty("--light-square", theme.lightSquare);
  root.style.setProperty("--dark-square", theme.darkSquare);
  root.style.setProperty("--legal-dot", theme.legalDot ?? DEFAULT_LEGAL_DOT);
}
