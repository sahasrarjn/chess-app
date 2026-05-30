import type { ChessGame } from "../engine/chessGame";
import { toFEN } from "../engine/fen";
import type { BotDifficulty, Move } from "../engine/types";
import { chooseMinimaxMove } from "./chessBot";
import { EngineMoveRejectedError, fetchBotMove } from "./remoteEngine";

export type BotMoveSource = "server" | "builtin";

export type BotMoveOutcome = {
  move: Move | null;
  source: BotMoveSource;
  /** Set when the server was skipped or failed but the built-in bot found a move. */
  serverError?: string;
  serverUci?: string;
  fen: string;
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
  const fen = toFEN(game);
  let serverError: string | undefined;
  let serverUci: string | undefined;

  try {
    const remote = await fetchBotMove(game, difficulty, signal);
    if (remote) {
      return { move: remote.move, source: "server", serverUci: remote.serverUci, fen };
    }
    serverError = "Engine did not return a move";
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    if (err instanceof EngineMoveRejectedError) {
      serverUci = err.serverUci;
      serverError = err.message;
    } else {
      serverError =
        err instanceof Error ? err.message : "Cannot reach the chess engine";
    }
  }

  const local = chooseMinimaxMove(game, difficulty);
  if (local) {
    return { move: local, source: "builtin", serverError, serverUci, fen };
  }

  return { move: null, source: "builtin", serverError, serverUci, fen };
}
