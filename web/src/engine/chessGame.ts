import { sanFor } from "./moveNotation";
import {
  ALL_CASTLING,
  BOARD_SIZE,
  type CastlingRights,
  type GameResult,
  isBorder,
  isPlayable,
  type Move,
  moveUci,
  oppositeColor,
  type Piece,
  type PieceColor,
  type PieceKind,
  revokeCastling,
  sq,
  type Square,
  squareIsValid,
  canCastle,
} from "./types";

export interface UndoRecord {
  move: Move;
  captured: Piece | null;
  enPassantCaptured: Piece | null;
  previousCastling: CastlingRights;
  previousEnPassant: Square | null;
  previousHalfmove: number;
  previousFullmove: number;
  previousActiveColor: PieceColor;
  rookFrom: Square | null;
  rookTo: Square | null;
}

export interface RecordedMove {
  id: number;
  ply: number;
  san: string;
  color: PieceColor;
  move: Move;
  captured: Piece | null;
}

export interface GameSnapshot {
  board: (Piece | null)[][];
  activeColor: PieceColor;
  castlingRights: CastlingRights;
  enPassantTarget: Square | null;
  halfmoveClock: number;
  fullmoveNumber: number;
  lastMove: Move | null;
}

/** Serializable position for the offline bot Web Worker. */
export type BotSearchState = {
  board: (Piece | null)[][];
  activeColor: PieceColor;
  castlingRights: CastlingRights;
  enPassantTarget: Square | null;
  halfmoveClock: number;
  fullmoveNumber: number;
  resignedBy: PieceColor | null;
};

const BISHOP_DIRS: [number, number][] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
const ROOK_DIRS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const PROMO_KINDS: PieceKind[] = ["Q", "R", "B", "N"];

export class ChessGame {
  board: (Piece | null)[][];
  activeColor: PieceColor;
  castlingRights: CastlingRights;
  enPassantTarget: Square | null;
  halfmoveClock: number;
  fullmoveNumber: number;
  moveHistory: UndoRecord[] = [];
  recordedMoves: RecordedMove[] = [];
  snapshots: GameSnapshot[] = [];
  lastMove: Move | null = null;
  resignedBy: PieceColor | null = null;
  private positionCounts = new Map<string, number>();

  constructor() {
    this.board = startingBoard();
    this.activeColor = "white";
    this.castlingRights = { ...ALL_CASTLING };
    this.enPassantTarget = null;
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.snapshots = [snapshotFrom(this)];
    this.registerPosition();
  }

  piece(at: Square): Piece | null {
    if (!squareIsValid(at)) return null;
    return this.board[at.row][at.col];
  }

  get result(): GameResult {
    if (this.resignedBy) {
      return { type: "resignation", winner: oppositeColor(this.resignedBy) };
    }
    if (this.isInsufficientMaterial) {
      return { type: "draw", reason: "insufficient material" };
    }
    if (this.isThreefoldRepetition) {
      return { type: "draw", reason: "threefold repetition" };
    }
    const moves = this.legalMoves(this.activeColor);
    if (moves.length === 0) {
      if (this.isInCheck(this.activeColor)) {
        return { type: "checkmate", winner: oppositeColor(this.activeColor) };
      }
      return { type: "stalemate" };
    }
    if (this.halfmoveClock >= 100) {
      return { type: "draw", reason: "50-move rule" };
    }
    return { type: "ongoing" };
  }

  get isThreefoldRepetition(): boolean {
    return (this.positionCounts.get(this.positionKey()) ?? 0) >= 3;
  }

  get isInsufficientMaterial(): boolean {
    const white: PieceKind[] = [];
    const black: PieceKind[] = [];
    for (const row of this.board) {
      for (const cell of row) {
        if (!cell || cell.kind === "K") continue;
        if (cell.color === "white") white.push(cell.kind);
        else black.push(cell.kind);
      }
    }
    if (white.length === 0 && black.length === 0) return true;
    const minors = new Set<PieceKind>(["B", "N"]);
    if (white.every((k) => minors.has(k)) && black.length === 0) return white.length <= 1;
    if (black.every((k) => minors.has(k)) && white.length === 0) return black.length <= 1;
    if (
      white.length === 1 &&
      black.length === 1 &&
      !["P", "Q", "R"].includes(white[0]) &&
      !["P", "Q", "R"].includes(black[0])
    ) {
      return true;
    }
    return false;
  }

  snapshot(atPly: number): GameSnapshot {
    const i = Math.min(Math.max(atPly, 0), this.snapshots.length - 1);
    return this.snapshots[i];
  }

  resign(by: PieceColor): void {
    this.resignedBy = by;
  }

  isInCheck(color: PieceColor): boolean {
    const king = this.findKing(color);
    if (!king) return false;
    return this.isSquareAttacked(king, oppositeColor(color));
  }

  findKing(color: PieceColor): Square | null {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const p = this.board[row][col];
        if (p?.kind === "K" && p.color === color) return sq(row, col);
      }
    }
    return null;
  }

  legalMoves(color?: PieceColor): Move[] {
    const c = color ?? this.activeColor;
    const moves: Move[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const s = sq(row, col);
        const piece = this.board[row][col];
        if (piece?.color === c) {
          moves.push(...this.pseudoLegalMoves(s, piece));
        }
      }
    }
    return moves.filter((m) => !this.wouldLeaveKingInCheck(m, c));
  }

  applyMove(move: Move): boolean {
    if (!squareIsValid(move.to)) return false;
    const legal = this.legalMoves(this.activeColor);
    const ok = legal.some(
      (m) =>
        squaresEqual(m.from, move.from) &&
        squaresEqual(m.to, move.to) &&
        m.promotion === move.promotion
    );
    if (!ok) return false;
    this.applyMoveUnchecked(move, true);
    return true;
  }

  applyMoveUnchecked(move: Move, recordHistory: boolean): void {
    const san = recordHistory ? sanFor(move, this) : null;
    const moving = this.board[move.from.row][move.from.col]!;
    const movingColor = this.activeColor;
    let captured: Piece | null = this.board[move.to.row][move.to.col];
    let enPassantCaptured: Piece | null = null;
    let rookFrom: Square | null = null;
    let rookTo: Square | null = null;

    if (move.isEnPassant) {
      const capRow = move.from.row;
      const capCol = move.to.col;
      enPassantCaptured = this.board[capRow][capCol];
      this.board[capRow][capCol] = null;
      captured = enPassantCaptured;
    }

    this.board[move.to.row][move.to.col] = moving;
    this.board[move.from.row][move.from.col] = null;

    if (move.isCastle) {
      const row = move.from.row;
      if (move.to.col === 7) {
        rookFrom = sq(row, 8);
        rookTo = sq(row, 6);
      } else {
        rookFrom = sq(row, 1);
        rookTo = sq(row, 4);
      }
      this.board[rookTo.row][rookTo.col] = this.board[rookFrom.row][rookFrom.col];
      this.board[rookFrom.row][rookFrom.col] = null;
    }

    if (move.promotion) {
      this.board[move.to.row][move.to.col] = { kind: move.promotion, color: moving.color };
    }

    const previousCastling = { ...this.castlingRights };
    const previousEnPassant = this.enPassantTarget;
    const previousHalfmove = this.halfmoveClock;
    const previousFullmove = this.fullmoveNumber;
    const previousActiveColor = this.activeColor;

    this.castlingRights = this.updateCastlingRights(move, moving, captured);
    this.enPassantTarget = this.updateEnPassant(move, moving);

    const prevHalf = previousHalfmove;
    if (moving.kind === "P" || captured) {
      this.halfmoveClock = 0;
    } else {
      this.halfmoveClock += 1;
    }

    if (this.activeColor === "black") {
      this.fullmoveNumber += 1;
    }

    const record: UndoRecord = {
      move,
      captured,
      enPassantCaptured,
      previousCastling,
      previousEnPassant,
      previousHalfmove: prevHalf,
      previousFullmove,
      previousActiveColor,
      rookFrom,
      rookTo,
    };

    this.lastMove = move;
    this.activeColor = oppositeColor(this.activeColor);

    if (recordHistory) {
      this.moveHistory.push(record);
      const ply = this.recordedMoves.length;
      this.recordedMoves.push({
        id: ply,
        ply,
        san: san ?? moveUci(move),
        color: movingColor,
        move,
        captured: captured ?? enPassantCaptured,
      });
      this.snapshots.push(snapshotFrom(this));
      this.registerPosition();
    }
  }

  undoLastMove(): boolean {
    const record = this.moveHistory.pop();
    if (!record) return false;

    this.unregisterPosition();
    if (this.snapshots.length) this.snapshots.pop();
    if (this.recordedMoves.length) this.recordedMoves.pop();

    this.activeColor = record.previousActiveColor;
    this.castlingRights = record.previousCastling;
    this.enPassantTarget = record.previousEnPassant;
    this.halfmoveClock = record.previousHalfmove;
    this.fullmoveNumber = record.previousFullmove;

    const move = record.move;
    const piece = this.board[move.to.row][move.to.col]!;

    this.board[move.from.row][move.from.col] = {
      kind: move.promotion ? "P" : piece.kind,
      color: piece.color,
    };
    this.board[move.to.row][move.to.col] = record.captured;

    if (move.isEnPassant && record.enPassantCaptured) {
      this.board[move.from.row][move.to.col] = record.enPassantCaptured;
    }

    if (record.rookFrom && record.rookTo) {
      this.board[record.rookFrom.row][record.rookFrom.col] =
        this.board[record.rookTo.row][record.rookTo.col];
      this.board[record.rookTo.row][record.rookTo.col] = null;
    }

    this.lastMove = this.moveHistory.at(-1)?.move ?? null;
    return true;
  }

  copy(): ChessGame {
    const g = new ChessGame();
    g.board = this.board.map((r) => r.map((c) => (c ? { ...c } : null)));
    g.activeColor = this.activeColor;
    g.castlingRights = { ...this.castlingRights };
    g.enPassantTarget = this.enPassantTarget;
    g.halfmoveClock = this.halfmoveClock;
    g.fullmoveNumber = this.fullmoveNumber;
    g.lastMove = this.lastMove;
    g.moveHistory = [...this.moveHistory];
    g.recordedMoves = [...this.recordedMoves];
    g.snapshots = [...this.snapshots];
    g.resignedBy = this.resignedBy;
    g.positionCounts = new Map(this.positionCounts);
    return g;
  }

  /** Clear move history after FEN import or bot-worker load. */
  resetLoadedPosition(): void {
    this.moveHistory = [];
    this.recordedMoves = [];
    this.lastMove = null;
    this.snapshots = [snapshotFrom(this)];
    this.positionCounts = new Map();
    this.registerPosition();
  }

  static fromSearchState(state: BotSearchState): ChessGame {
    const g = new ChessGame();
    g.board = state.board.map((r) => r.map((c) => (c ? { ...c } : null)));
    g.activeColor = state.activeColor;
    g.castlingRights = { ...state.castlingRights };
    g.enPassantTarget = state.enPassantTarget;
    g.halfmoveClock = state.halfmoveClock;
    g.fullmoveNumber = state.fullmoveNumber;
    g.resignedBy = state.resignedBy;
    g.resetLoadedPosition();
    return g;
  }

  toSearchState(): BotSearchState {
    return {
      board: this.board.map((r) => r.map((c) => (c ? { ...c } : null))),
      activeColor: this.activeColor,
      castlingRights: { ...this.castlingRights },
      enPassantTarget: this.enPassantTarget,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
      resignedBy: this.resignedBy,
    };
  }

  private pseudoLegalMoves(from: Square, piece: Piece): Move[] {
    switch (piece.kind) {
      case "P":
        return this.pawnMoves(from, piece.color);
      case "N":
        return this.knightMoves(from, piece.color);
      case "B":
        return this.slidingMoves(from, piece.color, BISHOP_DIRS);
      case "R":
        return this.slidingMoves(from, piece.color, ROOK_DIRS);
      case "Q":
        return this.slidingMoves(from, piece.color, [...BISHOP_DIRS, ...ROOK_DIRS]);
      case "K":
        return this.kingMoves(from, piece.color);
    }
  }

  private forwardDelta(color: PieceColor): number {
    return color === "white" ? -1 : 1;
  }

  private pawnStartRow(color: PieceColor): number {
    return color === "white" ? 7 : 2;
  }

  private promotionRow(color: PieceColor): number {
    return color === "white" ? 0 : BOARD_SIZE - 1;
  }

  /**
   * A pawn's straight push may land on any on-board square, including the outer
   * border ring: a pawn can advance up a border file (a/j) and promote on the
   * corner, matching Fairy-Stockfish. Diagonal capture targets are handled
   * separately in pawnMoves.
   */
  private isPawnDestination(s: Square): boolean {
    return squareIsValid(s);
  }

  private pawnMoves(from: Square, color: PieceColor): Move[] {
    const moves: Move[] = [];
    const dir = this.forwardDelta(color);
    const oneForward = sq(from.row + dir, from.col);

    if (
      this.isPawnDestination(oneForward) &&
      !this.board[oneForward.row][oneForward.col]
    ) {
      if (oneForward.row === this.promotionRow(color)) {
        for (const kind of PROMO_KINDS) {
          moves.push({ from, to: oneForward, promotion: kind });
        }
      } else {
        moves.push({ from, to: oneForward });
      }

      if (from.row === this.pawnStartRow(color)) {
        const twoForward = sq(from.row + 2 * dir, from.col);
        if (
          squareIsValid(twoForward) &&
          !this.board[twoForward.row][twoForward.col]
        ) {
          moves.push({ from, to: twoForward });
        }
      }
    }

    for (const dc of [-1, 1]) {
      const capture = sq(from.row + dir, from.col + dc);
      // A pawn may capture diagonally onto a border square: enemy pieces can
      // slide onto the outer ring, and a diagonally adjacent pawn must be able
      // to take them. Unlike forward moves, captures aren't limited to playable
      // squares (isPawnDestination); any on-board square with an enemy is fair.
      if (!squareIsValid(capture)) continue;

      const target = this.board[capture.row][capture.col];
      if (target && target.color !== color) {
        if (capture.row === this.promotionRow(color)) {
          for (const kind of PROMO_KINDS) {
            moves.push({ from, to: capture, promotion: kind });
          }
        } else {
          moves.push({ from, to: capture });
        }
      } else if (
        this.enPassantTarget &&
        squaresEqual(this.enPassantTarget, capture)
      ) {
        if (capture.row === this.promotionRow(color)) {
          for (const kind of PROMO_KINDS) {
            moves.push({ from, to: capture, promotion: kind, isEnPassant: true });
          }
        } else {
          moves.push({ from, to: capture, isEnPassant: true });
        }
      }
    }
    return moves;
  }

  private knightMoves(from: Square, color: PieceColor): Move[] {
    const offsets: [number, number][] = [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1],
    ];
    const moves: Move[] = [];
    for (const [dr, dc] of offsets) {
      const to = sq(from.row + dr, from.col + dc);
      if (squareIsValid(to) && this.canMoveTo(to, color)) {
        moves.push({ from, to });
      }
    }
    return moves;
  }

  private slidingMoves(
    from: Square,
    color: PieceColor,
    directions: [number, number][]
  ): Move[] {
    const moves: Move[] = [];
    for (const [dr, dc] of directions) {
      let r = from.row + dr;
      let c = from.col + dc;
      while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
        const to = sq(r, c);
        const target = this.board[r][c];
        if (target) {
          if (target.color !== color) moves.push({ from, to });
          break;
        }
        moves.push({ from, to });
        if (isPlayable(from.row, from.col) && isBorder(to.row, to.col)) break;
        r += dr;
        c += dc;
      }
    }
    return moves;
  }

  private kingMoves(from: Square, color: PieceColor): Move[] {
    const moves: Move[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const to = sq(from.row + dr, from.col + dc);
        if (squareIsValid(to) && this.canMoveTo(to, color)) {
          moves.push({ from, to });
        }
      }
    }
    if (isPlayable(from.row, from.col)) {
      moves.push(...this.castlingMoves(color, from));
    }
    return moves;
  }

  private castlingMoves(color: PieceColor, kingSquare: Square): Move[] {
    const moves: Move[] = [];
    const row = color === "white" ? 8 : 1;

    if (canCastle(this.castlingRights, color, true)) {
      const f = sq(row, 6);
      const g = sq(row, 7);
      const rook = sq(row, 8);
      if (this.canCastleMove(color, kingSquare, [f, g], rook)) {
        moves.push({ from: kingSquare, to: g, isCastle: true });
      }
    }

    if (canCastle(this.castlingRights, color, false)) {
      const d = sq(row, 4);
      const c = sq(row, 3);
      const b = sq(row, 2);
      const rook = sq(row, 1);
      if (this.canCastleMove(color, kingSquare, [d, c, b], rook)) {
        moves.push({ from: kingSquare, to: c, isCastle: true });
      }
    }
    return moves;
  }

  private canCastleMove(
    color: PieceColor,
    king: Square,
    through: Square[],
    rook: Square
  ): boolean {
    const backRank = color === "white" ? 8 : 1;
    if (king.row !== backRank || king.col !== 5) return false;
    const rookPiece = this.board[rook.row][rook.col];
    if (rookPiece?.kind !== "R" || rookPiece.color !== color) return false;

    for (const sq of through) {
      if (this.board[sq.row][sq.col]) return false;
      if (this.isSquareAttacked(sq, oppositeColor(color))) return false;
    }
    if (this.isSquareAttacked(king, oppositeColor(color))) return false;
    return true;
  }

  private canMoveTo(square: Square, color: PieceColor): boolean {
    if (!squareIsValid(square)) return false;
    const target = this.board[square.row][square.col];
    return !target || target.color !== color;
  }

  isSquareAttacked(square: Square, by: PieceColor): boolean {
    if (!squareIsValid(square)) return false;

    const pawnDir = this.forwardDelta(oppositeColor(by));
    for (const dc of [-1, 1]) {
      const r = square.row + pawnDir;
      const c = square.col + dc;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
        const p = this.board[r][c];
        if (p?.kind === "P" && p.color === by) return true;
      }
    }

    const knightOffsets: [number, number][] = [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1],
    ];
    for (const [dr, dc] of knightOffsets) {
      const r = square.row + dr;
      const c = square.col + dc;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
        const p = this.board[r][c];
        if (p?.kind === "N" && p.color === by) return true;
      }
    }

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = square.row + dr;
        const c = square.col + dc;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
          const p = this.board[r][c];
          if (p?.kind === "K" && p.color === by) return true;
        }
      }
    }

    for (const [dr, dc] of BISHOP_DIRS) {
      if (this.rayAttacks(square, dr, dc, by, false)) return true;
    }
    for (const [dr, dc] of ROOK_DIRS) {
      if (this.rayAttacks(square, dr, dc, by, true)) return true;
    }
    return false;
  }

  private rayAttacks(
    square: Square,
    dr: number,
    dc: number,
    color: PieceColor,
    rook: boolean
  ): boolean {
    let r = square.row + dr;
    let c = square.col + dc;
    while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
      const p = this.board[r][c];
      if (p) {
        if (p.color === color) {
          if (rook && (p.kind === "R" || p.kind === "Q")) return true;
          if (!rook && (p.kind === "B" || p.kind === "Q")) return true;
        }
        return false;
      }
      r += dr;
      c += dc;
    }
    return false;
  }

  private wouldLeaveKingInCheck(move: Move, color: PieceColor): boolean {
    const copy = this.copy();
    copy.applyMoveUnchecked(move, false);
    return copy.isInCheck(color);
  }

  private updateCastlingRights(
    move: Move,
    piece: Piece,
    captured: Piece | null
  ): CastlingRights {
    let rights = this.castlingRights;
    if (piece.kind === "K") {
      rights = revokeCastling(rights, piece.color);
    }
    if (piece.kind === "R") {
      const row = piece.color === "white" ? 8 : 1;
      if (squaresEqual(move.from, sq(row, 1))) {
        rights = revokeCastling(rights, piece.color, false);
      }
      if (squaresEqual(move.from, sq(row, 8))) {
        rights = revokeCastling(rights, piece.color, true);
      }
    }
    if (captured?.kind === "R") {
      const row = captured.color === "white" ? 8 : 1;
      if (squaresEqual(move.to, sq(row, 1))) {
        rights = revokeCastling(rights, captured.color, false);
      }
      if (squaresEqual(move.to, sq(row, 8))) {
        rights = revokeCastling(rights, captured.color, true);
      }
    }
    return rights;
  }

  private updateEnPassant(move: Move, piece: Piece): Square | null {
    if (piece.kind === "P" && Math.abs(move.to.row - move.from.row) === 2) {
      const dir = this.forwardDelta(piece.color);
      return sq(move.from.row + dir, move.from.col);
    }
    return null;
  }

  private positionKey(): string {
    const parts: string[] = [this.activeColor === "white" ? "w" : "b"];
    for (const row of this.board) {
      for (const cell of row) {
        if (cell) {
          parts.push(`${cell.color === "white" ? "w" : "b"}${cell.kind}`);
        } else {
          parts.push(".");
        }
      }
    }
    let castle = "";
    if (this.castlingRights.whiteKingSide) castle += "K";
    if (this.castlingRights.whiteQueenSide) castle += "Q";
    if (this.castlingRights.blackKingSide) castle += "k";
    if (this.castlingRights.blackQueenSide) castle += "q";
    parts.push(castle);
    if (this.enPassantTarget) {
      parts.push(standardNotationForKey(this.enPassantTarget));
    }
    return parts.join("|");
  }

  private registerPosition(): void {
    const key = this.positionKey();
    this.positionCounts.set(key, (this.positionCounts.get(key) ?? 0) + 1);
  }

  private unregisterPosition(): void {
    const key = this.positionKey();
    const count = this.positionCounts.get(key) ?? 0;
    if (count > 1) this.positionCounts.set(key, count - 1);
    else this.positionCounts.delete(key);
  }
}

function standardNotationForKey(s: Square): string {
  const file = String.fromCharCode(97 + s.col - 1);
  return `${file}${9 - s.row}`;
}

export function squaresEqual(a: Square, b: Square): boolean {
  return a.row === b.row && a.col === b.col;
}

function startingBoard(): (Piece | null)[][] {
  const b: (Piece | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(null)
  );
  const whiteBack = 8;
  const whitePawns = 7;
  const blackBack = 1;
  const blackPawns = 2;
  const backRank: PieceKind[] = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  for (let i = 0; i < backRank.length; i++) {
    b[whiteBack][i + 1] = { kind: backRank[i], color: "white" };
    b[blackBack][i + 1] = { kind: backRank[i], color: "black" };
  }
  for (let col = 1; col <= 8; col++) {
    b[whitePawns][col] = { kind: "P", color: "white" };
    b[blackPawns][col] = { kind: "P", color: "black" };
  }
  return b;
}

export function snapshotFrom(game: ChessGame): GameSnapshot {
  return {
    board: game.board.map((r) => r.map((c) => (c ? { ...c } : null))),
    activeColor: game.activeColor,
    castlingRights: { ...game.castlingRights },
    enPassantTarget: game.enPassantTarget,
    halfmoveClock: game.halfmoveClock,
    fullmoveNumber: game.fullmoveNumber,
    lastMove: game.lastMove,
  };
}
