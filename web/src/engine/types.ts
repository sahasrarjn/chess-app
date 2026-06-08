export type PieceColor = "white" | "black";

export type PieceKind = "K" | "Q" | "R" | "B" | "N" | "P";

export interface Piece {
  kind: PieceKind;
  color: PieceColor;
}

export interface Square {
  row: number;
  col: number;
}

export const BOARD_SIZE = 10;
export const PLAYABLE_RANGE = { min: 1, max: 8 } as const;

export function isPlayable(row: number, col: number): boolean {
  return (
    row >= PLAYABLE_RANGE.min &&
    row <= PLAYABLE_RANGE.max &&
    col >= PLAYABLE_RANGE.min &&
    col <= PLAYABLE_RANGE.max
  );
}

export function isBorder(row: number, col: number): boolean {
  return !isPlayable(row, col);
}

export function isValidSquare(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function sq(row: number, col: number): Square {
  return { row, col };
}

export function squareIsValid(s: Square): boolean {
  return isValidSquare(s.row, s.col);
}

export function squareIsPlayable(s: Square): boolean {
  return isPlayable(s.row, s.col);
}

export function oppositeColor(c: PieceColor): PieceColor {
  return c === "white" ? "black" : "white";
}

export function pieceValue(kind: PieceKind): number {
  switch (kind) {
    case "P":
      return 100;
    case "N":
    case "B":
      return 320;
    case "R":
      return 500;
    case "Q":
      return 900;
    case "K":
      return 20_000;
  }
}

export function pieceAssetName(piece: Piece): string {
  const prefix = piece.color === "white" ? "w" : "b";
  return `${prefix}${piece.kind}`;
}

/** Inner 8×8 notation (a1–h8). */
export function standardNotation(s: Square): string {
  if (!squareIsPlayable(s)) return engineNotation(s);
  const file = String.fromCharCode(97 + s.col - 1);
  return `${file}${9 - s.row}`;
}

/** Full 10×10 engine notation (a1–j10). */
export function engineNotation(s: Square): string {
  const file = String.fromCharCode(97 + s.col);
  return `${file}${BOARD_SIZE - s.row}`;
}

export function fromStandardNotation(text: string): Square | null {
  const trimmed = text.toLowerCase();
  if (trimmed.length !== 2) return null;
  const file = trimmed.charCodeAt(0) - 97;
  const rank = parseInt(trimmed[1], 10);
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  const s = sq(9 - rank, file + 1);
  return squareIsPlayable(s) ? s : null;
}

export function fromEngineNotation(text: string): Square | null {
  const trimmed = text.toLowerCase();
  if (trimmed.length < 2) return null;
  const file = trimmed.charCodeAt(0) - 97;
  let rankEnd = 1;
  if (trimmed[1] === "1" && trimmed.length > 2 && trimmed[2] === "0") {
    rankEnd = 3;
  } else {
    rankEnd = 2;
  }
  const rank = parseInt(trimmed.slice(1, rankEnd), 10);
  if (rank < 1 || rank > BOARD_SIZE) return null;
  const s = sq(BOARD_SIZE - rank, file);
  return squareIsValid(s) ? s : null;
}

export function standardFileLabel(col: number): string | null {
  if (!isPlayable(4, col)) return null;
  return String.fromCharCode(97 + col - 1);
}

export function standardRankLabel(row: number): string | null {
  if (!isPlayable(row, 4)) return null;
  return String(9 - row);
}

/** Engine file label (a–j) for the full 10×10 grid. */
export function engineFileLabel(col: number): string | null {
  if (col < 0 || col >= BOARD_SIZE) return null;
  return String.fromCharCode(97 + col);
}

/** Engine rank label (1–10) for the full 10×10 grid. */
export function engineRankLabel(row: number): string | null {
  if (row < 0 || row >= BOARD_SIZE) return null;
  return String(BOARD_SIZE - row);
}

export interface Move {
  from: Square;
  to: Square;
  promotion?: PieceKind;
  isCastle?: boolean;
  isEnPassant?: boolean;
}

export function moveUci(move: Move): string {
  // Use engine notation for both squares when either touches the border ring.
  // Mixed notation (standard from + engine to) produces strings like "e4f10"
  // that resolveUciInterpretations cannot correctly round-trip.
  const encode =
    !squareIsPlayable(move.from) || !squareIsPlayable(move.to)
      ? engineNotation
      : standardNotation;
  let text = `${encode(move.from)}${encode(move.to)}`;
  if (move.promotion) text += move.promotion.toLowerCase();
  return text;
}

export interface CastlingRights {
  whiteKingSide: boolean;
  whiteQueenSide: boolean;
  blackKingSide: boolean;
  blackQueenSide: boolean;
}

export const ALL_CASTLING: CastlingRights = {
  whiteKingSide: true,
  whiteQueenSide: true,
  blackKingSide: true,
  blackQueenSide: true,
};

export function canCastle(
  rights: CastlingRights,
  color: PieceColor,
  kingSide: boolean
): boolean {
  if (color === "white") return kingSide ? rights.whiteKingSide : rights.whiteQueenSide;
  return kingSide ? rights.blackKingSide : rights.blackQueenSide;
}

export function revokeCastling(
  rights: CastlingRights,
  color: PieceColor,
  kingSide?: boolean
): CastlingRights {
  const next = { ...rights };
  if (color === "white") {
    if (kingSide === undefined) {
      next.whiteKingSide = false;
      next.whiteQueenSide = false;
    } else if (kingSide) next.whiteKingSide = false;
    else next.whiteQueenSide = false;
  } else {
    if (kingSide === undefined) {
      next.blackKingSide = false;
      next.blackQueenSide = false;
    } else if (kingSide) next.blackKingSide = false;
    else next.blackQueenSide = false;
  }
  return next;
}

export type GameResult =
  | { type: "ongoing" }
  | { type: "checkmate"; winner: PieceColor }
  | { type: "stalemate" }
  | { type: "resignation"; winner: PieceColor }
  | { type: "draw"; reason: string };

export type GameMode = "vsBot" | "localTwoPlayer";

export type BotDifficulty = "easy" | "medium" | "hard";

export function difficultyElo(d: BotDifficulty): number {
  switch (d) {
    case "easy":
      return 800;
    case "medium":
      return 1200;
    case "hard":
      return 1600;
  }
}

export function difficultyMovetime(d: BotDifficulty): number {
  switch (d) {
    case "easy":
      return 200;
    case "medium":
      return 500;
    case "hard":
      return 900;
  }
}

export function difficultyMinThinkMs(d: BotDifficulty): number {
  switch (d) {
    case "easy":
      return 120;
    case "medium":
      return 200;
    case "hard":
      return 300;
  }
}

/** Minimax depth for the built-in offline bot (mirrors iOS). */
export function difficultySearchDepth(d: BotDifficulty): number {
  switch (d) {
    case "easy":
      return 1;
    case "medium":
      return 3;
    case "hard":
      return 4;
  }
}

/** Chance to play a random legal move instead of the best line (easy/medium only). */
export function difficultyRandomness(d: BotDifficulty): number {
  switch (d) {
    case "easy":
      return 0.6;
    case "medium":
      return 0.12;
    case "hard":
      return 0;
  }
}
