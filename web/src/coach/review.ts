import { ChessGame } from "../engine/chessGame";
import { fromFEN, matchEngineMove, toFEN } from "../engine/fen";
import type { PieceColor } from "../engine/types";
import { analyzePosition, REVIEW_MOVETIME_MS, type AnalyzeFn } from "./analyzeClient";
import {
  classifyMove,
  toWhiteRelative,
  MATE_CP,
  type MoveClassification,
  type PositionEval,
} from "./classify";

export interface ReviewedMove {
  ply: number; // 1-based, matches move list
  uci: string;
  mover: PieceColor;
  classification: MoveClassification;
  swing: number; // clamped cp swing actually used
  bestMoveUci: string | null; // engine's choice in the position before the move
  explanation: string | null; // template text for mistake/blunder, else null
}

export interface ReviewResult {
  moves: ReviewedMove[];
  accuracy: { white: number; black: number }; // whole percents
  keyMoments: ReviewedMove[]; // top 3 by swing, desc, classification != "ok"
}

export const REVIEW_PENALTY: Record<MoveClassification, number> = {
  ok: 0,
  inaccuracy: 10,
  mistake: 25,
  blunder: 50,
};

export function reviewAccuracy(classifications: MoveClassification[]): number {
  if (classifications.length === 0) return 100;
  const total = classifications.reduce((s, c) => s + REVIEW_PENALTY[c], 0);
  return Math.max(0, 100 - Math.round(total / classifications.length));
}

/**
 * Normalized White-relative cp swing for a single move (clamped to CLAMP_CP).
 * Replicates the swing computation from classify.ts for use in review sorting.
 */
function computeSwing(before: PositionEval, after: PositionEval, mover: PieceColor): number {
  const CLAMP_CP = 1_500;
  function normalizedCp(e: PositionEval): number {
    if (e.mateIn != null) {
      const sign = e.mateIn > 0 ? 1 : -1;
      return sign * (MATE_CP - Math.abs(e.mateIn));
    }
    return Math.max(-CLAMP_CP, Math.min(CLAMP_CP, e.cp ?? 0));
  }
  const sign = mover === "white" ? 1 : -1;
  const moverBefore = normalizedCp(before) * sign;
  const moverAfter = normalizedCp(after) * sign;
  return Math.max(0, moverBefore - moverAfter);
}

export async function analyzeGameReview(
  movesUci: string[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
  analyze: AnalyzeFn = analyzePosition
): Promise<ReviewResult> {
  // Rebuild game from moves
  const game = new ChessGame();
  const positions: { fen: string; color: PieceColor }[] = [];

  // Collect position FENs before each move
  for (const uci of movesUci) {
    positions.push({ fen: toFEN(game), color: game.activeColor });
    const move = matchEngineMove(game, uci);
    if (!move) break;
    game.applyMoveUnchecked(move, false);
  }

  // Also record the final position
  const finalResult = game.result;
  const isFinalTerminal =
    finalResult.type === "checkmate" || finalResult.type === "stalemate";

  // Total positions to analyze: all pre-move positions + final if not checkmate/stalemate
  const total = isFinalTerminal ? positions.length : positions.length + 1;

  // Analyze each position sequentially
  const evals: Array<PositionEval | null> = [];
  const bestMoves: Array<{ bestMoveUci: string | null; pv: string[] }> = [];

  let done = 0;
  onProgress(done, total);

  for (let i = 0; i < positions.length; i++) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const { fen, color } = positions[i];
    const posGame = fromFEN(fen);
    try {
      const result = await analyze(posGame, REVIEW_MOVETIME_MS, signal);
      const whiteRel = toWhiteRelative(result.scoreCp, result.mateIn, color);
      evals.push(whiteRel);
      bestMoves.push({ bestMoveUci: result.bestMoveUci, pv: result.pv });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      // Failure → null eval
      evals.push(null);
      bestMoves.push({ bestMoveUci: null, pv: [] });
    }
    done++;
    onProgress(done, total);
  }

  // Analyze final position if not terminal
  let finalEval: PositionEval | null = null;
  if (!isFinalTerminal) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const finalFen = toFEN(game);
    const finalGame = fromFEN(finalFen);
    try {
      const result = await analyze(finalGame, REVIEW_MOVETIME_MS, signal);
      finalEval = toWhiteRelative(result.scoreCp, result.mateIn, game.activeColor);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      finalEval = null;
    }
    done++;
    onProgress(done, total);
  } else {
    // Synthetic after-eval for the final position
    if (finalResult.type === "checkmate") {
      // The last mover won: determine winner
      const lastPosColor = positions[positions.length - 1]?.color ?? "white";
      // Winner is the one who just moved
      finalEval = {
        cp: lastPosColor === "white" ? MATE_CP : -MATE_CP,
        mateIn: null,
      };
    } else {
      finalEval = { cp: 0, mateIn: null };
    }
  }

  // Build ReviewedMove for each ply
  const reviewedMoves: ReviewedMove[] = [];

  for (let i = 0; i < movesUci.length; i++) {
    const plyNum = i + 1;
    const uci = movesUci[i];
    const mover = positions[i]?.color ?? "white";
    const bestData = bestMoves[i] ?? { bestMoveUci: null, pv: [] };

    const beforeEval = evals[i] ?? null;
    // After eval: next position's eval, or finalEval for the last move
    const afterEval: PositionEval | null =
      i < evals.length - 1 ? (evals[i + 1] ?? null) : finalEval;

    let classification: MoveClassification = "ok";
    let swing = 0;
    let explanation: string | null = null;

    if (beforeEval != null && afterEval != null) {
      classification = classifyMove(beforeEval, afterEval, mover);
      swing = computeSwing(beforeEval, afterEval, mover);
    }

    reviewedMoves.push({
      ply: plyNum,
      uci,
      mover,
      classification,
      swing,
      bestMoveUci: bestData.bestMoveUci,
      explanation,
    });
  }

  // Per-side accuracy
  const whiteMoves = reviewedMoves.filter((m) => m.mover === "white").map((m) => m.classification);
  const blackMoves = reviewedMoves.filter((m) => m.mover === "black").map((m) => m.classification);

  const accuracy = {
    white: reviewAccuracy(whiteMoves),
    black: reviewAccuracy(blackMoves),
  };

  // Key moments: top 3 non-ok by swing, descending
  const keyMoments = reviewedMoves
    .filter((m) => m.classification !== "ok")
    .sort((a, b) => b.swing - a.swing)
    .slice(0, 3);

  return { moves: reviewedMoves, accuracy, keyMoments };
}
