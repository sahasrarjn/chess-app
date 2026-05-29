import type { ChessGame } from "../engine/chessGame";
import type { Move } from "../engine/types";

/** Pick a random legal move when the remote engine is unavailable. */
export function pickFallbackMove(game: ChessGame): Move | null {
  const moves = game.legalMoves();
  if (moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)] ?? null;
}
