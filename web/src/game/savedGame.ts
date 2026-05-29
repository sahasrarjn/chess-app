import { matchEngineMove } from "../engine/fen";
import { ChessGame } from "../engine/chessGame";
import type { GameController } from "./gameController";
import type { BotDifficulty, GameMode, PieceColor } from "../engine/types";
import { moveUci } from "../engine/types";

export const SAVED_GAME_KEY = "chessborder.savedGame";
const SAVED_GAME_VERSION = 1;

export interface SavedGameSnapshot {
  version: typeof SAVED_GAME_VERSION;
  mode: GameMode;
  botDifficulty: BotDifficulty;
  moves: string[];
  resignedBy: PieceColor | null;
  boardFlipped: boolean;
  autoFlipBoard: boolean;
}

function shouldPersist(ctrl: GameController): boolean {
  return ctrl.livePly > 0 || ctrl.game.result.type !== "ongoing";
}

export function snapshotFromController(ctrl: GameController): SavedGameSnapshot {
  return {
    version: SAVED_GAME_VERSION,
    mode: ctrl.mode,
    botDifficulty: ctrl.botDifficulty,
    moves: ctrl.game.recordedMoves.map((r) => moveUci(r.move)),
    resignedBy: ctrl.game.resignedBy,
    boardFlipped: ctrl.boardFlipped,
    autoFlipBoard: ctrl.autoFlipBoard,
  };
}

export function restoreGameFromSnapshot(saved: SavedGameSnapshot): ChessGame | null {
  const game = new ChessGame();
  for (const uci of saved.moves) {
    const move = matchEngineMove(game, uci);
    if (!move || !game.applyMove(move)) return null;
  }
  if (saved.resignedBy) game.resign(saved.resignedBy);
  return game;
}

export function loadSavedGame(): SavedGameSnapshot | null {
  try {
    const raw = localStorage.getItem(SAVED_GAME_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSavedGameSnapshot(parsed)) return null;
    if (restoreGameFromSnapshot(parsed) == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveGameFromController(ctrl: GameController): void {
  if (!shouldPersist(ctrl)) return;
  try {
    localStorage.setItem(SAVED_GAME_KEY, JSON.stringify(snapshotFromController(ctrl)));
  } catch {
    // Ignore quota / private browsing errors.
  }
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(SAVED_GAME_KEY);
  } catch {
    // Ignore.
  }
}

function isSavedGameSnapshot(value: unknown): value is SavedGameSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== SAVED_GAME_VERSION) return false;
  if (v.mode !== "vsBot" && v.mode !== "localTwoPlayer") return false;
  if (v.botDifficulty !== "easy" && v.botDifficulty !== "medium" && v.botDifficulty !== "hard") {
    return false;
  }
  if (!Array.isArray(v.moves) || !v.moves.every((m) => typeof m === "string")) return false;
  if (v.resignedBy !== null && v.resignedBy !== "white" && v.resignedBy !== "black") return false;
  if (typeof v.boardFlipped !== "boolean" || typeof v.autoFlipBoard !== "boolean") return false;
  return true;
}
