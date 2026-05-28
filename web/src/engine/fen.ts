import {
  BOARD_SIZE,
  engineNotation,
  fromEngineNotation,
  fromStandardNotation,
  type PieceKind,
  type Square,
} from "./types";
import type { ChessGame } from "./chessGame";
import { squaresEqual } from "./chessGame";
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
  // Run-length "10" is invalid for API/engine FEN (digit 0); use dots like variants.ini.
  if (empty > 0) {
    result += empty >= BOARD_SIZE ? ".".repeat(empty) : String(empty);
  }
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

/** Match Fairy-Stockfish UCI to a legal move (mirrors Swift move(fromEngineUCI:)). */
export function matchEngineMove(game: ChessGame, uci: string): ReturnType<ChessGame["legalMoves"]>[0] | null {
  const trimmed = uci.trim().toLowerCase();
  if (trimmed.length < 4) return null;

  let from: Square | null = null;
  let to: Square | null = null;
  let promotion: PieceKind | undefined;

  const engineParsed = parseEngineMove(trimmed);
  if (engineParsed) {
    from = engineParsed.from;
    to = engineParsed.to;
    promotion = engineParsed.promotion;
  } else {
    const fromStr = trimmed.slice(0, 2);
    const toStr = trimmed.slice(2, 4);
    const promoChar = trimmed.length > 4 ? trimmed[4] : undefined;
    from = fromStandardNotation(fromStr) ?? fromEngineNotation(fromStr);
    to = fromStandardNotation(toStr) ?? fromEngineNotation(toStr);
    if (promoChar && ["q", "r", "b", "n"].includes(promoChar)) {
      promotion = promoChar.toUpperCase() as PieceKind;
    }
  }

  if (!from || !to) return null;

  const color = game.activeColor;
  const candidates = game.legalMoves(color).filter(
    (m) =>
      squaresEqual(m.from, from) &&
      squaresEqual(m.to, to) &&
      (promotion === undefined || m.promotion === promotion)
  );

  return (
    candidates[0] ??
    game.legalMoves(color).find(
      (m) => squaresEqual(m.from, from) && squaresEqual(m.to, to)
    ) ??
    null
  );
}
