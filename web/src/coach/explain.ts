import { fromFEN, matchEngineMove } from "../engine/fen";
import {
  oppositeColor,
  pieceValue,
  standardNotation,
  type PieceColor,
  type PieceKind,
  type Square,
} from "../engine/types";
import { normalizedCp, type MoveClassification, type PositionEval } from "./classify";

export interface ExplainInput {
  fen: string; // position BEFORE the move
  movePlayed: string; // UCI
  bestMoveUci: string | null; // engine's preferred move in the same position
  pv: string[];
  before: PositionEval; // White-relative
  after: PositionEval; // White-relative
  classification: MoveClassification;
  mover: PieceColor;
}

/** Human-readable piece name (lowercase, singular). */
function pieceName(kind: PieceKind): string {
  switch (kind) {
    case "Q":
      return "queen";
    case "R":
      return "rook";
    case "B":
      return "bishop";
    case "N":
      return "knight";
    case "P":
      return "pawn";
    case "K":
      return "king";
  }
}

/**
 * Count the number of attackers a side has on a square (for pieces of that side
 * found on the board). Pawn moves are only counted when the pawn changes file
 * (captures), not pushes. Known approximation: absolutely-pinned attackers are
 * included in legal-move counts so they may be slightly over-counted in edge
 * cases; acceptable for template explanations.
 */
function countAttackers(
  game: ReturnType<typeof fromFEN>,
  square: Square,
  attackerColor: PieceColor
): { count: number; minValue: number } {
  const moves = game.legalMoves(attackerColor);
  let count = 0;
  let minValue = Infinity;
  for (const m of moves) {
    if (m.to.row !== square.row || m.to.col !== square.col) continue;
    const piece = game.board[m.from.row][m.from.col];
    if (!piece) continue;
    // Skip pawn pushes (pawn moves that don't change file)
    if (piece.kind === "P" && m.from.col === m.to.col) continue;
    count++;
    const v = pieceValue(piece.kind);
    if (v < minValue) minValue = v;
  }
  return { count, minValue };
}

/**
 * Count how many mover-colored pieces can recapture on a square.
 * We temporarily place a same-kind opponent piece on the square to make the
 * recapture legal, count mover legal moves that land on it, then restore.
 * This approximates defender counting; pinned defenders are excluded by the
 * legal-move generator, which is the safe-for-UI direction.
 */
function countDefenders(
  game: ReturnType<typeof fromFEN>,
  square: Square,
  moverColor: PieceColor,
  pieceKind: PieceKind
): number {
  const orig = game.board[square.row][square.col];
  game.board[square.row][square.col] = { kind: pieceKind, color: oppositeColor(moverColor) };
  const moves = game.legalMoves(moverColor);
  let count = 0;
  for (const m of moves) {
    if (m.to.row !== square.row || m.to.col !== square.col) continue;
    if (m.from.row === square.row && m.from.col === square.col) continue;
    const piece = game.board[m.from.row][m.from.col];
    if (!piece) continue;
    if (piece.kind === "P" && m.from.col === m.to.col) continue; // skip pawn pushes
    count++;
  }
  game.board[square.row][square.col] = orig;
  return count;
}

/**
 * Check if a piece on the given square is "hung": attacked by an opponent piece
 * of lower value (or any attacker when there are no defenders), and was not
 * already hung on the pre-move board.
 */
function isHung(
  game: ReturnType<typeof fromFEN>,
  square: Square,
  moverColor: PieceColor,
  preMoveGame: ReturnType<typeof fromFEN>
): boolean {
  const piece = game.board[square.row][square.col];
  if (!piece || piece.kind === "K") return false; // skip kings
  if (piece.color !== moverColor) return false;

  const opponent = oppositeColor(moverColor);
  const { count: attackerCount, minValue: minAttackerVal } = countAttackers(
    game,
    square,
    opponent
  );
  if (attackerCount === 0) return false;

  const defCount = countDefenders(game, square, moverColor, piece.kind);
  const pv = pieceValue(piece.kind);
  const isCurrentlyHung = defCount === 0 || minAttackerVal < pv;
  if (!isCurrentlyHung) return false;

  // Check if it was already hung before the move (pre-existing weakness)
  const prePiece = preMoveGame.board[square.row][square.col];
  if (prePiece && prePiece.color === moverColor && prePiece.kind !== "K") {
    const { count: preAttackers, minValue: preMinVal } = countAttackers(
      preMoveGame,
      square,
      opponent
    );
    const preDefCount = countDefenders(preMoveGame, square, moverColor, prePiece.kind);
    const wasAlreadyHung = preAttackers > 0 && (preDefCount === 0 || preMinVal < pv);
    if (wasAlreadyHung) return false;
  }

  return true;
}

export function explainMove(input: ExplainInput): string {
  const { fen, movePlayed, bestMoveUci, pv, before, after, mover } = input;
  const sign = mover === "white" ? 1 : -1;

  // 1. Walked into mate
  if (after.mateIn != null && after.mateIn * sign < 0) {
    return `This allows mate in ${Math.abs(after.mateIn)}.`;
  }

  // 2. Missed mate
  const best = bestMoveUci ?? pv[0] ?? null;
  if (before.mateIn != null && before.mateIn * sign > 0 && best != null) {
    if (movePlayed !== best) {
      return `You had mate in ${Math.abs(before.mateIn)}, starting with ${best}.`;
    }
  }

  const preMoveGame = fromFEN(fen);
  const moveObj = matchEngineMove(preMoveGame, movePlayed);
  if (moveObj) {
    const postMoveGame = preMoveGame.copy();
    postMoveGame.applyMoveUnchecked(moveObj, false);
    const preMoveGame2 = fromFEN(fen); // fresh copy for pre-move checks

    // 3. Hung piece — check destination square first, then other mover-colored non-king pieces
    const movedTo = moveObj.to;
    const movedPiece = postMoveGame.board[movedTo.row][movedTo.col];

    // Collect all mover-colored pieces on the post-move board
    const squaresToCheck: Square[] = [];
    if (movedPiece && movedPiece.kind !== "K") {
      squaresToCheck.push(movedTo);
    }
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        if (r === movedTo.row && c === movedTo.col) continue;
        const p = postMoveGame.board[r][c];
        if (p && p.color === mover && p.kind !== "K") {
          squaresToCheck.push({ row: r, col: c });
        }
      }
    }

    for (const sq of squaresToCheck) {
      if (isHung(postMoveGame, sq, mover, preMoveGame2)) {
        const piece = postMoveGame.board[sq.row][sq.col]!;
        const sqName = standardNotation(sq);
        return `Your ${pieceName(piece.kind)} on ${sqName} is hanging — it can simply be taken.`;
      }
    }

    // 4. Missed capture — best move captures a piece of value >= knight
    if (best != null) {
      const bestMove = matchEngineMove(preMoveGame2, best);
      if (bestMove) {
        const captured = preMoveGame2.board[bestMove.to.row][bestMove.to.col];
        if (
          captured &&
          captured.color !== mover &&
          pieceValue(captured.kind) >= pieceValue("N")
        ) {
          // Check that movePlayed is not itself an equal-or-greater capture
          const playedCapture = preMoveGame2.board[moveObj.to.row][moveObj.to.col];
          const playedCaptureValue = playedCapture ? pieceValue(playedCapture.kind) : 0;
          if (playedCaptureValue < pieceValue(captured.kind)) {
            const capName = pieceName(captured.kind);
            const capSq = standardNotation(bestMove.to);
            return `You missed ${best}, winning the ${capName} on ${capSq}.`;
          }
        }
      }
    }
  }

  // 5. Generic fallback
  return bestMoveUci != null
    ? `This loses ground — the engine preferred ${bestMoveUci}.`
    : `This loses ground.`;
}

/**
 * One-line "why" for the hint move, from the cached analysis of the current position.
 * Returns null when evalAtPosition is null (no cached analysis available).
 */
export function hintWhy(
  fen: string,
  bestUci: string,
  evalAtPosition: PositionEval | null,
  mover: PieceColor
): string | null {
  if (evalAtPosition === null) return null;

  const sign = mover === "white" ? 1 : -1;

  // 1. Mate favorable to mover
  if (
    evalAtPosition.mateIn != null &&
    evalAtPosition.mateIn * sign > 0
  ) {
    return `Mates in ${Math.abs(evalAtPosition.mateIn)}.`;
  }

  const game = fromFEN(fen);
  const bestMove = matchEngineMove(game, bestUci);
  if (!bestMove) {
    // Can't parse move — fall through to generic
    const moverCp = Math.max(0, normalizedCp(evalAtPosition) * sign);
    return `Engine's top move (+${(moverCp / 100).toFixed(1)}).`;
  }

  // 2. Best move is a capture
  const captured = game.board[bestMove.to.row][bestMove.to.col];
  if (captured && captured.color !== mover) {
    return `Wins the ${pieceName(captured.kind)} on ${standardNotation(bestMove.to)}.`;
  }

  // 3. Best move gives check
  const after = game.copy();
  after.applyMoveUnchecked(bestMove, false);
  if (after.isInCheck(oppositeColor(mover))) {
    return "Forcing check.";
  }

  // 4. Generic
  const moverCp = Math.max(0, normalizedCp(evalAtPosition) * sign);
  return `Engine's top move (+${(moverCp / 100).toFixed(1)}).`;
}
