import type { ChessGame } from "./chessGame";
import { squaresEqual } from "./chessGame";
import type { Move, Piece } from "./types";
import { standardNotation } from "./types";

export function sanFor(move: Move, game: ChessGame): string {
  if (move.isCastle) {
    return move.to.col > move.from.col ? "O-O" : "O-O-O";
  }

  const piece = game.piece(move.from);
  if (!piece) return "";

  const isCapture = game.piece(move.to) != null || move.isEnPassant;
  let san: string;

  if (piece.kind === "P") {
    if (isCapture) {
      san = `${fileLetter(move.from.col)}x${standardNotation(move.to)}`;
    } else {
      san = standardNotation(move.to);
    }
    if (move.promotion) san += `=${move.promotion}`;
  } else {
    san = disambiguation(move, piece, game);
    san += piece.kind;
    if (isCapture) san += "x";
    san += standardNotation(move.to);
  }

  const copy = game.copy();
  copy.applyMoveUnchecked(move, false);

  switch (copy.result.type) {
    case "checkmate":
      san += "#";
      break;
    case "ongoing":
      if (copy.isInCheck(copy.activeColor)) san += "+";
      break;
  }

  return san;
}

function fileLetter(col: number): string {
  return String.fromCharCode(97 + col - 1);
}

function disambiguation(move: Move, piece: Piece, game: ChessGame): string {
  const others = game.legalMoves(game.activeColor).filter((m) => {
    if (!squaresEqual(m.to, move.to) || squaresEqual(m.from, move.from)) return false;
    const p = game.piece(m.from);
    return p?.kind === piece.kind && p.color === piece.color;
  });

  if (others.length === 0) return "";

  const sameFile = others.some((m) => m.from.col === move.from.col);
  const sameRank = others.some((m) => m.from.row === move.from.row);

  if (!sameFile) return fileLetter(move.from.col);
  if (!sameRank) return String(9 - move.from.row);
  return standardNotation(move.from);
}
