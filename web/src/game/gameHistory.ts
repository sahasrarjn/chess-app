import type { ChessGame } from "../engine/chessGame";
import type { BotDifficulty, GameMode, PieceColor } from "../engine/types";
import { moveUci } from "../engine/types";

export const GAME_HISTORY_KEY = "chessborder.gameHistory";
const HISTORY_VERSION = 1;
export const MAX_HISTORY_GAMES = 25;

export type HistoryGameMode = GameMode | "online";
export type GameResultType = "checkmate" | "stalemate" | "resignation" | "draw";

/** Mirrors the server GameRecord field-for-field (gameId is local for
 *  guest/device records and server-assigned for cloud copies). */
export interface CompletedGameRecord {
  gameId: string;
  mode: HistoryGameMode;
  difficulty: BotDifficulty | null;
  playerColor: PieceColor | null;
  opponent: string;
  moves: string[];
  resultType: GameResultType;
  winner: PieceColor | null;
  endedAt: string; // ISO 8601
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadGameHistory(storage: StorageLike = localStorage): CompletedGameRecord[] {
  try {
    const raw = storage.getItem(GAME_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { version?: unknown }).version !== HISTORY_VERSION ||
      !Array.isArray((parsed as { games?: unknown }).games)
    ) {
      return [];
    }
    return (parsed as { games: CompletedGameRecord[] }).games;
  } catch {
    return [];
  }
}

/** Prepend a completed game, capped at 25, newest first. Returns false (and
 *  stores nothing) when an existing entry has the same mode + moves +
 *  resultType — this guards reloading a finished saved game. endedAt is
 *  deliberately excluded from the dedupe key (it is rebuilt on restore). */
export function appendGameToHistory(
  record: CompletedGameRecord,
  storage: StorageLike = localStorage
): boolean {
  const games = loadGameHistory(storage);
  const movesKey = record.moves.join(" ");
  const dup = games.some(
    (g) => g.mode === record.mode && g.resultType === record.resultType && g.moves.join(" ") === movesKey
  );
  if (dup) return false;
  const next = [record, ...games].slice(0, MAX_HISTORY_GAMES);
  try {
    storage.setItem(GAME_HISTORY_KEY, JSON.stringify({ version: HISTORY_VERSION, games: next }));
  } catch {
    return false; // quota / private browsing — history is best-effort
  }
  return true;
}

/** Build a record from a finished game. Returns null while the game is ongoing. */
export function completedGameRecord(opts: {
  game: ChessGame;
  mode: HistoryGameMode;
  difficulty: BotDifficulty | null;
  playerColor: PieceColor | null;
  opponent: string;
  endedAt?: string;
}): CompletedGameRecord | null {
  const result = opts.game.result;
  if (result.type === "ongoing") return null;
  return {
    gameId: crypto.randomUUID(),
    mode: opts.mode,
    difficulty: opts.difficulty,
    playerColor: opts.playerColor,
    opponent: opts.opponent,
    moves: opts.game.recordedMoves.map((r) => moveUci(r.move)),
    resultType: result.type,
    winner: "winner" in result ? result.winner : null,
    endedAt: opts.endedAt ?? new Date().toISOString(),
  };
}

/** List-row badge for a record. kind drives the CSS class. */
export function resultLabel(record: CompletedGameRecord): {
  text: string;
  kind: "win" | "loss" | "draw" | "neutral";
} {
  if (record.playerColor == null) {
    // Pass-and-play: no owning side — show the score.
    if (record.winner === "white") return { text: "1–0", kind: "neutral" };
    if (record.winner === "black") return { text: "0–1", kind: "neutral" };
    return { text: "½", kind: "neutral" };
  }
  if (record.winner == null) return { text: "D", kind: "draw" };
  return record.winner === record.playerColor
    ? { text: "W", kind: "win" }
    : { text: "L", kind: "loss" };
}
