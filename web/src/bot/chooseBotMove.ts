import type { ChessGame } from "../engine/chessGame";
import type { BotDifficulty, Move } from "../engine/types";
import { chooseMinimaxMove } from "./chessBot";
import { fetchBotMove } from "./remoteEngine";

export type BotMoveSource = "server" | "builtin";

export type BotMoveOutcome = {
  move: Move | null;
  source: BotMoveSource;
  /** Set when the server was skipped or failed but the built-in bot found a move. */
  serverError?: string;
};

/**
 * Prefer Fairy-Stockfish on the server; fall back to local minimax so play never
 * degrades to a random legal move.
 */
export async function chooseBotMove(
  game: ChessGame,
  difficulty: BotDifficulty,
  signal?: AbortSignal
): Promise<BotMoveOutcome> {
  let serverError: string | undefined;

  try {
    const remote = await fetchBotMove(game, difficulty, signal);
    if (remote) {
      return { move: remote, source: "server" };
    }
    serverError = "Engine did not return a move";
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    serverError =
      err instanceof Error ? err.message : "Cannot reach the chess engine";
  }

  const local = chooseMinimaxMove(game, difficulty);
  if (local) {
    return { move: local, source: "builtin", serverError };
  }

  return { move: null, source: "builtin", serverError };
}
