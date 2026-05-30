import type { ChessGame } from "../engine/chessGame";
import type { BotDifficulty, Move, PieceColor, Square } from "../engine/types";
import {
  BOARD_SIZE,
  difficultyRandomness,
  difficultySearchDepth,
  oppositeColor,
  pieceValue,
  sq,
} from "../engine/types";

const CENTER_SQUARES: Square[] = [
  sq(4, 4),
  sq(4, 5),
  sq(5, 4),
  sq(5, 5),
];

function isCenter(row: number, col: number): boolean {
  return CENTER_SQUARES.some((s) => s.row === row && s.col === col);
}

function materialScore(game: ChessGame, color: PieceColor): number {
  let score = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = game.board[row][col];
      if (!piece) continue;
      const v = pieceValue(piece.kind);
      score += piece.color === color ? v : -v;
    }
  }
  return score;
}

function evaluate(game: ChessGame, color: PieceColor): number {
  let score = materialScore(game, color);

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = game.board[row][col];
      if (!piece) continue;
      let pieceScore = 0;
      if (isCenter(row, col)) pieceScore += 15;
      if (piece.kind === "P") {
        const advanced = color === "white" ? 7 - row : row - 2;
        pieceScore += advanced * 8;
      }
      score += piece.color === color ? pieceScore : -pieceScore;
    }
  }

  if (game.isInCheck(oppositeColor(color))) score += 30;
  if (game.isInCheck(color)) score -= 30;

  return score;
}

function minimax(
  game: ChessGame,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: PieceColor,
  rootColor: PieceColor,
  maxDepth: number
): number {
  const result = game.result;
  if (result.type === "checkmate") {
    const win = result.winner === rootColor;
    const dist = maxDepth - depth;
    return win ? 100_000 - dist : -100_000 + dist;
  }
  if (result.type === "stalemate" || result.type === "draw" || result.type === "resignation") {
    return 0;
  }

  if (depth === 0) return evaluate(game, rootColor);

  const moves = game.legalMoves(maximizing);
  let a = alpha;
  let b = beta;

  if (maximizing === rootColor) {
    let maxEval = Number.MIN_SAFE_INTEGER;
    for (const move of moves) {
      const copy = game.copy();
      copy.applyMoveUnchecked(move, false);
      const evalScore = minimax(
        copy,
        depth - 1,
        a,
        b,
        oppositeColor(maximizing),
        rootColor,
        maxDepth
      );
      maxEval = Math.max(maxEval, evalScore);
      a = Math.max(a, evalScore);
      if (b <= a) break;
    }
    return maxEval;
  }

  let minEval = Number.MAX_SAFE_INTEGER;
  for (const move of moves) {
    const copy = game.copy();
    copy.applyMoveUnchecked(move, false);
    const evalScore = minimax(
      copy,
      depth - 1,
      a,
      b,
      oppositeColor(maximizing),
      rootColor,
      maxDepth
    );
    minEval = Math.min(minEval, evalScore);
    b = Math.min(b, evalScore);
    if (b <= a) break;
  }
  return minEval;
}

/** Built-in bot: minimax with alpha-beta (same logic as iOS ChessBot). */
export function chooseMinimaxMove(
  game: ChessGame,
  difficulty: BotDifficulty
): Move | null {
  const moves = game.legalMoves();
  if (moves.length === 0) return null;

  const randomness = difficultyRandomness(difficulty);
  if (randomness > 0 && Math.random() < randomness) {
    return moves[Math.floor(Math.random() * moves.length)] ?? null;
  }

  const color = game.activeColor;
  const depth = difficultySearchDepth(difficulty);
  let bestMove = moves[0]!;
  let bestScore = Number.MIN_SAFE_INTEGER;

  for (const move of moves) {
    const copy = game.copy();
    copy.applyMoveUnchecked(move, false);
    const score = minimax(
      copy,
      depth - 1,
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      oppositeColor(color),
      color,
      depth
    );
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}
