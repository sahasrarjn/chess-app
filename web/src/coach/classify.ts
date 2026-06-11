import type { PieceColor } from "../engine/types";

export type MoveClassification = "ok" | "inaccuracy" | "mistake" | "blunder";

/** White-relative engine evaluation. Exactly one field is non-null. */
export interface PositionEval {
  /** Centipawns, White-relative. Null when the position is a forced mate. */
  cp: number | null;
  /** Mate distance, White-relative: +N = White mates in N, -N = Black mates in N. */
  mateIn: number | null;
}

export const MATE_CP = 10_000;
export const CLAMP_CP = 1_500;
/** A mover still at/above this (own-perspective cp) after missing a mate is a mistake, not a blunder. */
export const WINNING_CP = 300;
export const INACCURACY_CP = 50;
export const MISTAKE_CP = 150;
export const BLUNDER_CP = 300;

/** Convert a server analysis (side-to-move perspective) to White-relative.
 *  mate_in === 0 (side to move is already mated) maps defensively to ∓MATE_CP cp —
 *  callers should never analyze terminal positions, but nothing may NaN if they do. */
export function toWhiteRelative(
  scoreCp: number | null,
  mateIn: number | null,
  sideToMove: PieceColor
): PositionEval {
  const sign = sideToMove === "white" ? 1 : -1;
  if (mateIn != null) {
    if (mateIn === 0) return { cp: sign * -MATE_CP, mateIn: null };
    return { cp: null, mateIn: mateIn * sign };
  }
  return { cp: (scoreCp ?? 0) * sign, mateIn: null };
}

/** Mate-aware, clamped White-relative cp used for swing arithmetic. */
export function normalizedCp(e: PositionEval): number {
  if (e.mateIn != null) {
    const sign = e.mateIn > 0 ? 1 : -1;
    return sign * (MATE_CP - Math.abs(e.mateIn));
  }
  return Math.max(-CLAMP_CP, Math.min(CLAMP_CP, e.cp ?? 0));
}

/** Classify the move a player just made, from the evals before and after it.
 *  before/after are White-relative; mover is the side that made the move. */
export function classifyMove(
  before: PositionEval,
  after: PositionEval,
  mover: PieceColor
): MoveClassification {
  const sign = mover === "white" ? 1 : -1;
  const moverBefore = normalizedCp(before) * sign;
  const moverAfter = normalizedCp(after) * sign;

  const hadMate = before.mateIn != null && before.mateIn * sign > 0;
  const hasMate = after.mateIn != null && after.mateIn * sign > 0;
  const facedMate = before.mateIn != null && before.mateIn * sign < 0;
  const facesMate = after.mateIn != null && after.mateIn * sign < 0;

  if (hadMate && !hasMate) {
    return moverAfter >= WINNING_CP ? "mistake" : "blunder"; // missed a forced mate
  }
  if (facesMate && !facedMate) {
    return moverBefore >= -WINNING_CP ? "blunder" : "ok"; // walked into mate (unless already lost)
  }

  const swing = Math.max(0, moverBefore - moverAfter);
  if (swing >= BLUNDER_CP) return "blunder";
  if (swing >= MISTAKE_CP) return "mistake";
  if (swing >= INACCURACY_CP) return "inaccuracy";
  return "ok";
}
