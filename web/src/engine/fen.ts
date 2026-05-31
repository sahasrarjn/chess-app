import {
  BOARD_SIZE,
  type CastlingRights,
  engineNotation,
  fromEngineNotation,
  fromStandardNotation,
  type Piece,
  type PieceKind,
  type Square,
} from "./types";
import { ChessGame, squaresEqual } from "./chessGame";
import { resolveUciInterpretations } from "./uci";

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

/** Load a Fairy-Stockfish chessborder FEN (for tests and diagnostics). */
export function fromFEN(fen: string): ChessGame {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) throw new Error("Invalid FEN");

  const ranks = parts[0].split("/");
  if (ranks.length !== BOARD_SIZE) throw new Error("Invalid FEN board");

  const game = new ChessGame();
  for (let row = 0; row < BOARD_SIZE; row++) {
    parseFenRank(ranks[row] ?? "", row, game.board);
  }

  game.activeColor = parts[1] === "b" ? "black" : "white";
  game.castlingRights = parseCastling(parts[2] ?? "-");
  game.enPassantTarget = parseEnPassant(parts[3] ?? "-");
  game.halfmoveClock = parts[4] ? parseInt(parts[4], 10) : 0;
  game.fullmoveNumber = parts[5] ? parseInt(parts[5], 10) : 1;
  game.resetLoadedPosition();
  return game;
}

function parseFenRank(rankStr: string, row: number, board: (Piece | null)[][]): void {
  let col = 0;
  for (const ch of rankStr) {
    if (col >= BOARD_SIZE) break;
    if (ch === ".") {
      board[row][col++] = null;
      continue;
    }
    if (ch >= "1" && ch <= "9") {
      const empty = parseInt(ch, 10);
      for (let i = 0; i < empty && col < BOARD_SIZE; i++) {
        board[row][col++] = null;
      }
      continue;
    }
    board[row][col++] = parsePieceChar(ch);
  }
  while (col < BOARD_SIZE) {
    board[row][col++] = null;
  }
}

function parsePieceChar(ch: string): Piece {
  const kind = ch.toUpperCase() as PieceKind;
  return { kind, color: ch === ch.toUpperCase() ? "white" : "black" };
}

function parseCastling(text: string): CastlingRights {
  if (text === "-") {
    return {
      whiteKingSide: false,
      whiteQueenSide: false,
      blackKingSide: false,
      blackQueenSide: false,
    };
  }
  return {
    whiteKingSide: text.includes("K"),
    whiteQueenSide: text.includes("Q"),
    blackKingSide: text.includes("k"),
    blackQueenSide: text.includes("q"),
  };
}

function parseEnPassant(text: string): Square | null {
  if (text === "-") return null;
  return fromEngineNotation(text) ?? fromStandardNotation(text);
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

function matchLegalMove(
  game: ChessGame,
  from: Square,
  to: Square,
  promotion?: PieceKind
): ReturnType<ChessGame["legalMoves"]>[0] | null {
  const color = game.activeColor;
  const strict = game.legalMoves(color).filter(
    (m) =>
      squaresEqual(m.from, from) &&
      squaresEqual(m.to, to) &&
      (promotion === undefined || m.promotion === promotion)
  );
  if (strict[0]) return strict[0];
  return (
    game.legalMoves(color).find(
      (m) => squaresEqual(m.from, from) && squaresEqual(m.to, to)
    ) ?? null
  );
}

/** Match Fairy-Stockfish UCI to a legal move (mirrors Swift move(fromEngineUCI:)). */
export function matchEngineMove(
  game: ChessGame,
  uci: string
): ReturnType<ChessGame["legalMoves"]>[0] | null {
  for (const { from, to, promotion } of resolveUciInterpretations(uci)) {
    const matched = matchLegalMove(game, from, to, promotion);
    if (matched) return matched;
  }
  return null;
}
