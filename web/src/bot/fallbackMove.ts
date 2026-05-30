import type { ChessGame } from "../engine/chessGame";
import type { BotDifficulty, Move } from "../engine/types";
import { chooseMinimaxMove } from "./chessBot";

/** Offline bot move when the remote engine is unavailable. */
export function pickFallbackMove(
  game: ChessGame,
  difficulty: BotDifficulty = "medium"
): Move | null {
  return chooseMinimaxMove(game, difficulty);
}
