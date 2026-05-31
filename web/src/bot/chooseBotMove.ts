import type { ChessGame } from "../engine/chessGame";
import { toFEN } from "../engine/fen";
import type { BotDifficulty, Move } from "../engine/types";
import { EngineMoveRejectedError, fetchBotMove } from "./remoteEngine";
import { chooseLocalBotMove } from "./localBot";

export type BotMoveSource = "server" | "builtin";

export type BotMoveOutcome = {
  move: Move | null;
  source: BotMoveSource;
  /** Set when the server was skipped or failed but the built-in bot found a move. */
  serverError?: string;
  serverUci?: string;
  fen: string;
  /** True when falling back to offline search after a network/empty response. */
  usedLocalFallback?: boolean;
};

/**
 * Prefer Fairy-Stockfish on the server. Rejected server moves fail fast (Retry Bot).
 * Network failures use a time-capped offline search in a Web Worker.
 */
export async function chooseBotMove(
  game: ChessGame,
  difficulty: BotDifficulty,
  signal?: AbortSignal,
  onPhase?: (phase: "remote" | "local") => void
): Promise<BotMoveOutcome> {
  const fen = toFEN(game);
  let serverError: string | undefined;
  let serverUci: string | undefined;

  onPhase?.("remote");
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
      return {
        move: null,
        source: "server",
        serverError: err.message,
        serverUci: err.serverUci,
        fen,
      };
    }
    serverError =
      err instanceof Error ? err.message : "Cannot reach the chess engine";
  }

  onPhase?.("local");
  const local = await chooseLocalBotMove(game, difficulty, undefined, signal);
  if (local) {
    return {
      move: local,
      source: "builtin",
      serverError,
      serverUci,
      fen,
      usedLocalFallback: true,
    };
  }

  return { move: null, source: "builtin", serverError, serverUci, fen };
}
