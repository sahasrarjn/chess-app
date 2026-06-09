#!/usr/bin/env tsx
"use strict";

// scripts/validate-move-cli.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

// src/engine/types.ts
var BOARD_SIZE = 10;
var PLAYABLE_RANGE = { min: 1, max: 8 };
function isPlayable(row, col) {
  return row >= PLAYABLE_RANGE.min && row <= PLAYABLE_RANGE.max && col >= PLAYABLE_RANGE.min && col <= PLAYABLE_RANGE.max;
}
function isBorder(row, col) {
  return !isPlayable(row, col);
}
function isValidSquare(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}
function sq(row, col) {
  return { row, col };
}
function squareIsValid(s) {
  return isValidSquare(s.row, s.col);
}
function squareIsPlayable(s) {
  return isPlayable(s.row, s.col);
}
function oppositeColor(c) {
  return c === "white" ? "black" : "white";
}
function standardNotation(s) {
  if (!squareIsPlayable(s)) return engineNotation(s);
  const file = String.fromCharCode(97 + s.col - 1);
  return `${file}${9 - s.row}`;
}
function engineNotation(s) {
  const file = String.fromCharCode(97 + s.col);
  return `${file}${BOARD_SIZE - s.row}`;
}
function fromStandardNotation(text) {
  const trimmed = text.toLowerCase();
  if (trimmed.length !== 2) return null;
  const file = trimmed.charCodeAt(0) - 97;
  const rank = parseInt(trimmed[1], 10);
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  const s = sq(9 - rank, file + 1);
  return squareIsPlayable(s) ? s : null;
}
function fromEngineNotation(text) {
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
function moveUci(move) {
  const encode = !squareIsPlayable(move.from) || !squareIsPlayable(move.to) ? engineNotation : standardNotation;
  let text = `${encode(move.from)}${encode(move.to)}`;
  if (move.promotion) text += move.promotion.toLowerCase();
  return text;
}
var ALL_CASTLING = {
  whiteKingSide: true,
  whiteQueenSide: true,
  blackKingSide: true,
  blackQueenSide: true
};
function canCastle(rights, color, kingSide) {
  if (color === "white") return kingSide ? rights.whiteKingSide : rights.whiteQueenSide;
  return kingSide ? rights.blackKingSide : rights.blackQueenSide;
}
function revokeCastling(rights, color, kingSide) {
  const next = { ...rights };
  if (color === "white") {
    if (kingSide === void 0) {
      next.whiteKingSide = false;
      next.whiteQueenSide = false;
    } else if (kingSide) next.whiteKingSide = false;
    else next.whiteQueenSide = false;
  } else {
    if (kingSide === void 0) {
      next.blackKingSide = false;
      next.blackQueenSide = false;
    } else if (kingSide) next.blackKingSide = false;
    else next.blackQueenSide = false;
  }
  return next;
}

// src/engine/moveNotation.ts
function sanFor(move, game) {
  if (move.isCastle) {
    return move.to.col > move.from.col ? "O-O" : "O-O-O";
  }
  const piece = game.piece(move.from);
  if (!piece) return "";
  const isCapture = game.piece(move.to) != null || move.isEnPassant;
  let san;
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
function fileLetter(col) {
  return String.fromCharCode(97 + col - 1);
}
function disambiguation(move, piece, game) {
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

// src/engine/chessGame.ts
var BISHOP_DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1]
];
var ROOK_DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
];
var PROMO_KINDS = ["Q", "R", "B", "N"];
var ChessGame = class _ChessGame {
  board;
  activeColor;
  castlingRights;
  enPassantTarget;
  halfmoveClock;
  fullmoveNumber;
  moveHistory = [];
  recordedMoves = [];
  snapshots = [];
  lastMove = null;
  resignedBy = null;
  positionCounts = /* @__PURE__ */ new Map();
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
  piece(at) {
    if (!squareIsValid(at)) return null;
    return this.board[at.row][at.col];
  }
  get result() {
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
  get isThreefoldRepetition() {
    return (this.positionCounts.get(this.positionKey()) ?? 0) >= 3;
  }
  get isInsufficientMaterial() {
    const white = [];
    const black = [];
    for (const row of this.board) {
      for (const cell of row) {
        if (!cell || cell.kind === "K") continue;
        if (cell.color === "white") white.push(cell.kind);
        else black.push(cell.kind);
      }
    }
    if (white.length === 0 && black.length === 0) return true;
    const minors = /* @__PURE__ */ new Set(["B", "N"]);
    if (white.every((k) => minors.has(k)) && black.length === 0) return white.length <= 1;
    if (black.every((k) => minors.has(k)) && white.length === 0) return black.length <= 1;
    if (white.length === 1 && black.length === 1 && !["P", "Q", "R"].includes(white[0]) && !["P", "Q", "R"].includes(black[0])) {
      return true;
    }
    return false;
  }
  snapshot(atPly) {
    const i = Math.min(Math.max(atPly, 0), this.snapshots.length - 1);
    return this.snapshots[i];
  }
  resign(by) {
    this.resignedBy = by;
  }
  isInCheck(color) {
    const king = this.findKing(color);
    if (!king) return false;
    return this.isSquareAttacked(king, oppositeColor(color));
  }
  findKing(color) {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const p = this.board[row][col];
        if (p?.kind === "K" && p.color === color) return sq(row, col);
      }
    }
    return null;
  }
  legalMoves(color) {
    const c = color ?? this.activeColor;
    const moves = [];
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
  applyMove(move) {
    if (!squareIsValid(move.to)) return false;
    const legal = this.legalMoves(this.activeColor);
    const ok = legal.some(
      (m) => squaresEqual(m.from, move.from) && squaresEqual(m.to, move.to) && m.promotion === move.promotion
    );
    if (!ok) return false;
    this.applyMoveUnchecked(move, true);
    return true;
  }
  applyMoveUnchecked(move, recordHistory) {
    const san = recordHistory ? sanFor(move, this) : null;
    const moving = this.board[move.from.row][move.from.col];
    const movingColor = this.activeColor;
    let captured = this.board[move.to.row][move.to.col];
    let enPassantCaptured = null;
    let rookFrom = null;
    let rookTo = null;
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
    const record = {
      move,
      captured,
      enPassantCaptured,
      previousCastling,
      previousEnPassant,
      previousHalfmove: prevHalf,
      previousFullmove,
      previousActiveColor,
      rookFrom,
      rookTo
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
        captured: captured ?? enPassantCaptured
      });
      this.snapshots.push(snapshotFrom(this));
      this.registerPosition();
    }
  }
  undoLastMove() {
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
    const piece = this.board[move.to.row][move.to.col];
    this.board[move.from.row][move.from.col] = {
      kind: move.promotion ? "P" : piece.kind,
      color: piece.color
    };
    this.board[move.to.row][move.to.col] = record.captured;
    if (move.isEnPassant && record.enPassantCaptured) {
      this.board[move.from.row][move.to.col] = record.enPassantCaptured;
    }
    if (record.rookFrom && record.rookTo) {
      this.board[record.rookFrom.row][record.rookFrom.col] = this.board[record.rookTo.row][record.rookTo.col];
      this.board[record.rookTo.row][record.rookTo.col] = null;
    }
    this.lastMove = this.moveHistory.at(-1)?.move ?? null;
    return true;
  }
  copy() {
    const g = new _ChessGame();
    g.board = this.board.map((r) => r.map((c) => c ? { ...c } : null));
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
  resetLoadedPosition() {
    this.moveHistory = [];
    this.recordedMoves = [];
    this.lastMove = null;
    this.snapshots = [snapshotFrom(this)];
    this.positionCounts = /* @__PURE__ */ new Map();
    this.registerPosition();
  }
  static fromSearchState(state) {
    const g = new _ChessGame();
    g.board = state.board.map((r) => r.map((c) => c ? { ...c } : null));
    g.activeColor = state.activeColor;
    g.castlingRights = { ...state.castlingRights };
    g.enPassantTarget = state.enPassantTarget;
    g.halfmoveClock = state.halfmoveClock;
    g.fullmoveNumber = state.fullmoveNumber;
    g.resignedBy = state.resignedBy;
    g.resetLoadedPosition();
    return g;
  }
  toSearchState() {
    return {
      board: this.board.map((r) => r.map((c) => c ? { ...c } : null)),
      activeColor: this.activeColor,
      castlingRights: { ...this.castlingRights },
      enPassantTarget: this.enPassantTarget,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
      resignedBy: this.resignedBy
    };
  }
  pseudoLegalMoves(from, piece) {
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
  forwardDelta(color) {
    return color === "white" ? -1 : 1;
  }
  pawnStartRow(color) {
    return color === "white" ? 7 : 2;
  }
  promotionRow(color) {
    return color === "white" ? 0 : BOARD_SIZE - 1;
  }
  /**
   * A pawn's straight push may land on any on-board square, including the outer
   * border ring: a pawn can advance up a border file (a/j) and promote on the
   * corner, matching Fairy-Stockfish. Diagonal capture targets are handled
   * separately in pawnMoves.
   */
  isPawnDestination(s) {
    return squareIsValid(s);
  }
  pawnMoves(from, color) {
    const moves = [];
    const dir = this.forwardDelta(color);
    const oneForward = sq(from.row + dir, from.col);
    if (this.isPawnDestination(oneForward) && !this.board[oneForward.row][oneForward.col]) {
      if (oneForward.row === this.promotionRow(color)) {
        for (const kind of PROMO_KINDS) {
          moves.push({ from, to: oneForward, promotion: kind });
        }
      } else {
        moves.push({ from, to: oneForward });
      }
      if (from.row === this.pawnStartRow(color)) {
        const twoForward = sq(from.row + 2 * dir, from.col);
        if (squareIsValid(twoForward) && !this.board[twoForward.row][twoForward.col]) {
          moves.push({ from, to: twoForward });
        }
      }
    }
    for (const dc of [-1, 1]) {
      const capture = sq(from.row + dir, from.col + dc);
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
      } else if (this.enPassantTarget && squaresEqual(this.enPassantTarget, capture)) {
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
  knightMoves(from, color) {
    const offsets = [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1]
    ];
    const moves = [];
    for (const [dr, dc] of offsets) {
      const to = sq(from.row + dr, from.col + dc);
      if (squareIsValid(to) && this.canMoveTo(to, color)) {
        moves.push({ from, to });
      }
    }
    return moves;
  }
  slidingMoves(from, color, directions) {
    const moves = [];
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
  kingMoves(from, color) {
    const moves = [];
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
  castlingMoves(color, kingSquare) {
    const moves = [];
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
  canCastleMove(color, king, through, rook) {
    const backRank = color === "white" ? 8 : 1;
    if (king.row !== backRank || king.col !== 5) return false;
    const rookPiece = this.board[rook.row][rook.col];
    if (rookPiece?.kind !== "R" || rookPiece.color !== color) return false;
    for (const sq2 of through) {
      if (this.board[sq2.row][sq2.col]) return false;
      if (this.isSquareAttacked(sq2, oppositeColor(color))) return false;
    }
    if (this.isSquareAttacked(king, oppositeColor(color))) return false;
    return true;
  }
  canMoveTo(square, color) {
    if (!squareIsValid(square)) return false;
    const target = this.board[square.row][square.col];
    return !target || target.color !== color;
  }
  isSquareAttacked(square, by) {
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
    const knightOffsets = [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1]
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
  rayAttacks(square, dr, dc, color, rook) {
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
  wouldLeaveKingInCheck(move, color) {
    const copy = this.copy();
    copy.applyMoveUnchecked(move, false);
    return copy.isInCheck(color);
  }
  updateCastlingRights(move, piece, captured) {
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
  updateEnPassant(move, piece) {
    if (piece.kind === "P" && Math.abs(move.to.row - move.from.row) === 2) {
      const dir = this.forwardDelta(piece.color);
      return sq(move.from.row + dir, move.from.col);
    }
    return null;
  }
  positionKey() {
    const parts = [this.activeColor === "white" ? "w" : "b"];
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
  registerPosition() {
    const key = this.positionKey();
    this.positionCounts.set(key, (this.positionCounts.get(key) ?? 0) + 1);
  }
  unregisterPosition() {
    const key = this.positionKey();
    const count = this.positionCounts.get(key) ?? 0;
    if (count > 1) this.positionCounts.set(key, count - 1);
    else this.positionCounts.delete(key);
  }
};
function standardNotationForKey(s) {
  const file = String.fromCharCode(97 + s.col - 1);
  return `${file}${9 - s.row}`;
}
function squaresEqual(a, b) {
  return a.row === b.row && a.col === b.col;
}
function startingBoard() {
  const b = Array.from(
    { length: BOARD_SIZE },
    () => Array(BOARD_SIZE).fill(null)
  );
  const whiteBack = 8;
  const whitePawns = 7;
  const blackBack = 1;
  const blackPawns = 2;
  const backRank = ["R", "N", "B", "Q", "K", "B", "N", "R"];
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
function snapshotFrom(game) {
  return {
    board: game.board.map((r) => r.map((c) => c ? { ...c } : null)),
    activeColor: game.activeColor,
    castlingRights: { ...game.castlingRights },
    enPassantTarget: game.enPassantTarget,
    halfmoveClock: game.halfmoveClock,
    fullmoveNumber: game.fullmoveNumber,
    lastMove: game.lastMove
  };
}

// src/engine/uci.ts
function promotionFromUciSuffix(trimmed) {
  if (trimmed.length <= 4) return void 0;
  const ch = trimmed[4]?.toUpperCase();
  if (ch && ["Q", "R", "B", "N"].includes(ch)) return ch;
  return void 0;
}
function resolveUciInterpretations(uci) {
  const trimmed = uci.trim().toLowerCase();
  if (trimmed.length < 4) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (from, to, promotion) => {
    const key = `${from.row},${from.col},${to.row},${to.col},${promotion ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ from, to, promotion });
  };
  const suffixPromo = promotionFromUciSuffix(trimmed);
  const engineParsed = parseEngineMove(trimmed);
  if (engineParsed) {
    push(
      engineParsed.from,
      engineParsed.to,
      engineParsed.promotion ?? suffixPromo
    );
  }
  const fromStr = trimmed.slice(0, 2);
  const toStr = trimmed.slice(2, 4);
  const fromStd = fromStandardNotation(fromStr);
  const toStd = fromStandardNotation(toStr);
  if (fromStd && toStd) push(fromStd, toStd, suffixPromo);
  const fromMix = fromStandardNotation(fromStr) ?? fromEngineNotation(fromStr);
  const toMix = fromStandardNotation(toStr) ?? fromEngineNotation(toStr);
  if (fromMix && toMix) push(fromMix, toMix, suffixPromo);
  return out;
}
function parseEngineMove(uci) {
  const trimmed = uci.trim().toLowerCase();
  if (trimmed.length < 4) return null;
  let index = 0;
  const from = parseEngineSquare(trimmed, index);
  if (!from) return null;
  index = from.nextIndex;
  const to = parseEngineSquare(trimmed, index);
  if (!to) return null;
  index = to.nextIndex;
  let promotion;
  if (index < trimmed.length) {
    const ch = trimmed[index].toUpperCase();
    if (["Q", "R", "B", "N"].includes(ch)) {
      promotion = ch;
    }
  }
  return { from: from.square, to: to.square, promotion };
}
function parseEngineSquare(text, start) {
  if (start >= text.length) return null;
  const file = text.charCodeAt(start) - 97;
  if (file < 0 || file > 9) return null;
  let index = start + 1;
  if (index >= text.length) return null;
  let rankEnd = index + 1;
  if (text[index] === "1" && rankEnd < text.length && text[rankEnd] === "0") {
    rankEnd += 1;
  }
  const rank = parseInt(text.slice(index, rankEnd), 10);
  if (rank < 1 || rank > BOARD_SIZE) return null;
  index = rankEnd;
  const parsed = fromEngineNotation(
    String.fromCharCode(97 + file) + (rank === 10 ? "10" : String(rank))
  );
  if (!parsed) return null;
  return { square: parsed, nextIndex: index };
}

// src/engine/fen.ts
function toFEN(game) {
  const ranks = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    ranks.push(fenRank(game, row));
  }
  const placement = ranks.join("/");
  const side = game.activeColor === "white" ? "w" : "b";
  const castle = fenCastling(game);
  const ep = game.enPassantTarget ? engineNotation(game.enPassantTarget) : "-";
  return `${placement} ${side} ${castle} ${ep} ${game.halfmoveClock} ${game.fullmoveNumber}`;
}
function fromFEN(fen) {
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
function parseFenRank(rankStr, row, board) {
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
function parsePieceChar(ch) {
  const kind = ch.toUpperCase();
  return { kind, color: ch === ch.toUpperCase() ? "white" : "black" };
}
function parseCastling(text) {
  if (text === "-") {
    return {
      whiteKingSide: false,
      whiteQueenSide: false,
      blackKingSide: false,
      blackQueenSide: false
    };
  }
  return {
    whiteKingSide: text.includes("K"),
    whiteQueenSide: text.includes("Q"),
    blackKingSide: text.includes("k"),
    blackQueenSide: text.includes("q")
  };
}
function parseEnPassant(text) {
  if (text === "-") return null;
  return fromEngineNotation(text) ?? fromStandardNotation(text);
}
function fenRank(game, row) {
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
  if (empty > 0) {
    result += empty >= BOARD_SIZE ? ".".repeat(empty) : String(empty);
  }
  return result;
}
function fenCastling(game) {
  let s = "";
  if (game.castlingRights.whiteKingSide) s += "K";
  if (game.castlingRights.whiteQueenSide) s += "Q";
  if (game.castlingRights.blackKingSide) s += "k";
  if (game.castlingRights.blackQueenSide) s += "q";
  return s || "-";
}
function matchLegalMove(game, from, to, promotion) {
  const color = game.activeColor;
  const strict = game.legalMoves(color).filter(
    (m) => squaresEqual(m.from, from) && squaresEqual(m.to, to) && (promotion === void 0 || m.promotion === promotion)
  );
  if (strict[0]) return strict[0];
  return game.legalMoves(color).find(
    (m) => squaresEqual(m.from, from) && squaresEqual(m.to, to)
  ) ?? null;
}
function matchEngineMove(game, uci) {
  for (const { from, to, promotion } of resolveUciInterpretations(uci)) {
    const matched = matchLegalMove(game, from, to, promotion);
    if (matched) return matched;
  }
  return null;
}

// scripts/validate-move-cli.ts
function usage() {
  console.error("Usage: validate-move-cli.ts <fen> <uci>");
  console.error("   or: validate-move-cli.ts --corpus <path-to-engine-fen-corpus.json> [--server <url>]");
  console.error(
    "   or: validate-move-cli.ts --regression-fens <path-to-posthog-regression-fens.json> --server <url>"
  );
  process.exit(2);
}
async function validateRegressionFens(fensPath, serverUrl) {
  const raw = (0, import_node_fs.readFileSync)(fensPath, "utf8");
  const cases = JSON.parse(raw);
  let failed = 0;
  for (const testCase of cases) {
    const res = await fetch(`${serverUrl.replace(/\/$/, "")}/v1/move`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...process.env.API_KEY ? { "X-API-Key": process.env.API_KEY } : {}
      },
      body: JSON.stringify({ fen: testCase.fen, elo: 1200, movetime_ms: 100 })
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`FAIL ${testCase.name}: server HTTP ${res.status} ${text.slice(0, 120)}`);
      failed++;
      continue;
    }
    const data = await res.json();
    if (!data.uci) {
      console.error(`FAIL ${testCase.name}: server returned no uci`);
      failed++;
      continue;
    }
    const game = fromFEN(testCase.fen);
    const move = matchEngineMove(game, data.uci);
    if (!move || !game.applyMove(move)) {
      console.error(`FAIL ${testCase.name}: server uci ${data.uci} not legal locally`);
      failed++;
      continue;
    }
    console.log(`OK ${testCase.name} (${data.uci})`);
  }
  return failed > 0 ? 1 : 0;
}
async function validateCorpus(corpusPath, serverUrl) {
  const raw = (0, import_node_fs.readFileSync)(corpusPath, "utf8");
  const cases = JSON.parse(raw);
  let failed = 0;
  for (const testCase of cases) {
    const game = fromFEN(testCase.fen);
    for (const setup of testCase.setup_uci ?? []) {
      const setupMove = matchEngineMove(game, setup);
      if (!setupMove || !game.applyMove(setupMove)) {
        console.error(`FAIL setup ${testCase.name}: ${setup}`);
        failed++;
        continue;
      }
    }
    const move = matchEngineMove(game, testCase.uci);
    if (!move || !game.applyMove(move)) {
      console.error(`FAIL ${testCase.name}: ${testCase.uci} not legal locally`);
      failed++;
      continue;
    }
    if (serverUrl) {
      const serverGame = fromFEN(testCase.fen);
      for (const setup of testCase.setup_uci ?? []) {
        const setupMove = matchEngineMove(serverGame, setup);
        if (!setupMove || !serverGame.applyMove(setupMove)) {
          console.error(`FAIL setup ${testCase.name}: ${setup}`);
          failed++;
          continue;
        }
      }
      const fenForServer = toFEN(serverGame);
      const res = await fetch(`${serverUrl.replace(/\/$/, "")}/v1/move`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...process.env.API_KEY ? { "X-API-Key": process.env.API_KEY } : {}
        },
        body: JSON.stringify({ fen: fenForServer, elo: 1200, movetime_ms: 100 })
      });
      if (!res.ok) {
        console.error(`FAIL ${testCase.name}: server HTTP ${res.status}`);
        failed++;
        continue;
      }
      const data = await res.json();
      if (!data.uci) {
        console.error(`FAIL ${testCase.name}: server returned no uci`);
        failed++;
        continue;
      }
      const serverMove = matchEngineMove(serverGame, data.uci);
      if (!serverMove) {
        console.error(`FAIL ${testCase.name}: server uci ${data.uci} not legal locally`);
        failed++;
        continue;
      }
    }
    console.log(`OK ${testCase.name}`);
  }
  return failed > 0 ? 1 : 0;
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--corpus") {
    const corpusPath = (0, import_node_path.resolve)(args[1] ?? usage());
    const serverIdx = args.indexOf("--server");
    const serverUrl = serverIdx >= 0 ? args[serverIdx + 1] : void 0;
    process.exit(await validateCorpus(corpusPath, serverUrl));
  }
  if (args[0] === "--regression-fens") {
    const fensPath = (0, import_node_path.resolve)(args[1] ?? usage());
    const serverIdx = args.indexOf("--server");
    const serverUrl = serverIdx >= 0 ? args[serverIdx + 1] : void 0;
    if (!serverUrl) {
      console.error("FATAL: --regression-fens requires --server <url>");
      process.exit(2);
    }
    process.exit(await validateRegressionFens(fensPath, serverUrl));
  }
  const [fen, uci] = args;
  if (!fen || !uci) usage();
  const game = fromFEN(fen);
  const move = matchEngineMove(game, uci);
  if (!move || !game.applyMove(move)) {
    process.exit(1);
  }
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
