import { BOARD_SIZE, engineNotation } from "./types";
import type { ChessGame } from "./chessGame";
import { parseEngineMove } from "./uci";

export function toFEN(game: ChessGame): string {
  const ranks: string[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    ranks.push(fenRank(game, row));
  }
  const placement = ranks.join("/");
  const side = game.activeColor === "white" ? "w" : "b";
  const castle = fenCastling(game);
  const ep = game.enPassantTarget ? engineNotation(game.enPassantTarget) : "-";
  return `${placement} ${side} ${castle} ${ep} ${game.halfmoveClock} ${game.fullmoveNumber}`;
}

function fenRank(game: ChessGame, row: number): string {
  let result = "";
  let empty = 0;
  for (let col = 0; col < BOARD_SIZE; col++) {
    const piece = game.board[row][col];
    if (piece) {
      if (empty > 0) {
        result += String(empty);
        empty = 0;
      }
      const ch = piece.kind;
      result += piece.color === "white" ? ch : ch.toLowerCase();
    } else {
      empty += 1;
    }
  }
  if (empty > 0) result += String(empty);
  return result;
}

function fenCastling(game: ChessGame): string {
  let s = "";
  if (game.castlingRights.whiteKingSide) s += "K";
  if (game.castlingRights.whiteQueenSide) s += "Q";
  if (game.castlingRights.blackKingSide) s += "k";
  if (game.castlingRights.blackQueenSide) s += "q";
  return s || "-";
}

export function matchEngineMove(game: ChessGame, uci: string) {
  const parsed = parseEngineMove(uci.trim().toLowerCase());
  if (!parsed) return null;
  const { from, to, promotion } = parsed;
  const candidates = game.legalMoves(game.activeColor).filter(
    (m) =>
      m.from.row === from.row &&
      m.from.col === from.col &&
      m.to.row === to.row &&
      m.to.col === to.col &&
      m.promotion === promotion
  );
  return (
    candidates[0] ??
    game.legalMoves(game.activeColor).find(
      (m) =>
        m.from.row === from.row &&
        m.from.col === from.col &&
        m.to.row === to.row &&
        m.to.col === to.col
    ) ??
    null
  );
}
