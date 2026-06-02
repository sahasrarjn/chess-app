import type { GameResult, Move } from "../engine/types";

/** Distinct sound cues, 1:1 with the files in `web/public/sounds/<event>.mp3`. */
export type SoundEvent =
  | "move"
  | "capture"
  | "check"
  | "castle"
  | "promote"
  | "game-start"
  | "game-end"
  | "illegal";

export interface MoveSoundInput {
  /** `game.result.type` after the move was applied. */
  resultType: GameResult["type"];
  /** True if the move leaves the opponent in check (but not checkmate). */
  givesCheck: boolean;
  /** True if the move captured a piece (including en passant). */
  captured: boolean;
  move: Move;
}

/**
 * Pick the single cue for a just-applied move. Priority, high to low:
 * game-end > check > promote > castle > capture > move.
 */
export function classifyMoveSound(input: MoveSoundInput): SoundEvent {
  const { resultType, givesCheck, captured, move } = input;
  if (resultType === "checkmate" || resultType === "stalemate" || resultType === "draw") {
    return "game-end";
  }
  if (givesCheck) return "check";
  if (move.promotion) return "promote";
  if (move.isCastle) return "castle";
  if (captured) return "capture";
  return "move";
}
