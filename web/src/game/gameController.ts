import { fetchBotMove } from "../bot/remoteEngine";
import {
  ChessGame,
  snapshotFrom,
  squaresEqual,
  type GameSnapshot,
} from "../engine/chessGame";
import type {
  BotDifficulty,
  GameMode,
  GameResult,
  Piece,
  PieceColor,
  PieceKind,
  Square,
} from "../engine/types";
import {
  difficultyMinThinkMs,
  isPlayable,
  moveUci,
} from "../engine/types";

export type GameUpdateListener = () => void;

export class GameController {
  game = new ChessGame();
  selectedSquare: Square | null = null;
  legalTargets = new Set<string>();
  captureTargets = new Set<string>();
  pendingPromotion: { from: Square; to: Square } | null = null;
  isThinking = false;
  boardFlipped = false;
  previewPly: number | null = null;
  botEngineError: string | null = null;
  revision = 0;

  constructor(
    readonly mode: GameMode,
    readonly botDifficulty: BotDifficulty = "medium",
    private readonly onUpdate?: GameUpdateListener
  ) {}

  get livePly(): number {
    return this.game.recordedMoves.length;
  }

  get isBrowsingHistory(): boolean {
    return this.previewPly != null && this.previewPly < this.livePly;
  }

  get displaySnapshot(): GameSnapshot {
    if (this.previewPly != null) {
      return this.game.snapshot(this.previewPly);
    }
    return snapshotFrom(this.game);
  }

  get result(): GameResult {
    return this.game.result;
  }

  get isBotTurn(): boolean {
    return (
      this.mode === "vsBot" &&
      this.game.activeColor === "black" &&
      this.game.result.type === "ongoing" &&
      !this.isBrowsingHistory
    );
  }

  get canInteract(): boolean {
    return (
      this.game.result.type === "ongoing" &&
      !this.isThinking &&
      !this.isBotTurn &&
      !this.isBrowsingHistory
    );
  }

  get canRetryBot(): boolean {
    return (
      this.mode === "vsBot" &&
      this.botEngineError != null &&
      this.game.activeColor === "black" &&
      this.game.result.type === "ongoing" &&
      !this.isThinking &&
      !this.isBrowsingHistory
    );
  }

  squareKey(s: Square): string {
    return `${s.row},${s.col}`;
  }

  piece(at: Square): Piece | null {
    if (this.isBrowsingHistory) {
      const snap = this.displaySnapshot;
      return snap.board[at.row][at.col];
    }
    return this.game.piece(at);
  }

  notify(): void {
    this.revision++;
    if (this.mode === "localTwoPlayer" && !this.isBrowsingHistory) {
      this.boardFlipped = this.game.activeColor === "black";
    }
    this.onUpdate?.();
  }

  handleSquareTap(square: Square): void {
    const hasPiece = this.game.piece(square)?.color === this.game.activeColor;
    const key = this.squareKey(square);
    const isLegal = this.legalTargets.has(key);
    if (!isPlayable(square.row, square.col) && !hasPiece && !isLegal) return;
    if (!this.canInteract) return;

    if (this.selectedSquare) {
      if (squaresEqual(this.selectedSquare, square)) {
        this.clearSelection();
        return;
      }
      if (this.tryExecuteMove(this.selectedSquare, square, true)) return;

      const piece = this.game.piece(square);
      if (piece?.color === this.game.activeColor) {
        this.select(square);
      } else {
        this.clearSelection();
      }
      return;
    }

    if (this.game.piece(square)?.color === this.game.activeColor) {
      this.select(square);
    }
  }

  private select(square: Square): void {
    this.selectedSquare = square;
    const moves = this.game.legalMoves().filter((m) => squaresEqual(m.from, square));
    this.legalTargets = new Set(moves.map((m) => this.squareKey(m.to)));
    this.captureTargets = new Set(
      moves
        .filter((m) => this.game.piece(m.to) || m.isEnPassant)
        .map((m) => this.squareKey(m.to))
    );
    this.notify();
  }

  clearSelection(): void {
    this.selectedSquare = null;
    this.legalTargets.clear();
    this.captureTargets.clear();
    this.notify();
  }

  private tryExecuteMove(from: Square, to: Square, triggerBot: boolean): boolean {
    const candidates = this.game
      .legalMoves()
      .filter((m) => squaresEqual(m.from, from) && squaresEqual(m.to, to));

    if (candidates.some((m) => m.promotion)) {
      this.pendingPromotion = { from, to };
      this.notify();
      return true;
    }

    const move = candidates[0];
    if (!move || !this.game.piece(from)) return false;
    if (!this.game.applyMove(move)) return false;

    this.previewPly = null;
    this.clearSelection();
    this.notify();
    if (triggerBot) void this.maybePlayBotMove();
    return true;
  }

  promote(kind: PieceKind): void {
    const pending = this.pendingPromotion;
    if (!pending) return;
    const move = this.game.legalMoves().find(
      (m) =>
        squaresEqual(m.from, pending.from) &&
        squaresEqual(m.to, pending.to) &&
        m.promotion === kind
    );
    this.pendingPromotion = null;
    if (!move) return;
    if (!this.game.applyMove(move)) return;

    this.previewPly = null;
    this.clearSelection();
    this.notify();
    void this.maybePlayBotMove();
  }

  cancelPromotion(): void {
    this.pendingPromotion = null;
    this.clearSelection();
    this.notify();
  }

  undo(): void {
    const count = this.mode === "vsBot" ? 2 : 1;
    let undone = false;
    for (let i = 0; i < count; i++) {
      if (this.game.undoLastMove()) undone = true;
      else break;
    }
    if (undone) {
      this.previewPly = null;
      this.botEngineError = null;
      this.notify();
    }
    this.clearSelection();
  }

  resignGame(): void {
    this.game.resign(this.game.activeColor);
    this.notify();
  }

  newGame(): void {
    this.game = new ChessGame();
    this.clearSelection();
    this.pendingPromotion = null;
    this.isThinking = false;
    this.boardFlipped = false;
    this.previewPly = null;
    this.botEngineError = null;
    this.notify();
  }

  toggleBoardFlip(): void {
    this.boardFlipped = !this.boardFlipped;
    this.notify();
  }

  retryBotMove(): void {
    if (!this.canRetryBot) return;
    this.botEngineError = null;
    void this.maybePlayBotMove();
  }

  goToMove(ply: number): void {
    if (ply >= this.livePly) {
      this.previewPly = null;
    } else {
      this.previewPly = ply;
    }
    this.clearSelection();
  }

  stepBack(): void {
    this.goToMove(Math.max((this.previewPly ?? this.livePly) - 1, 0));
  }

  stepForward(): void {
    const current = this.previewPly ?? this.livePly;
    if (current >= this.livePly) this.previewPly = null;
    else this.goToMove(current + 1);
  }

  isKingInCheck(square: Square): boolean {
    if (this.isBrowsingHistory) return false;
    const piece = this.game.piece(square);
    if (piece?.kind !== "K") return false;
    return (
      this.game.isInCheck(piece.color) && this.game.activeColor === piece.color
    );
  }

  statusText(): string {
    const result = this.game.result;
    switch (result.type) {
      case "ongoing":
        if (this.botEngineError && this.mode === "vsBot") return this.botEngineError;
        if (this.isBrowsingHistory) {
          return `Reviewing move ${this.previewPly} of ${this.livePly}`;
        }
        if (this.isThinking) return "Bot is thinking…";
        if (this.game.isInCheck(this.game.activeColor)) {
          return this.game.activeColor === "white"
            ? "White is in check"
            : "Black is in check";
        }
        return this.game.activeColor === "white" ? "White to move" : "Black to move";
      case "checkmate":
        return result.winner === "white"
          ? "Checkmate — White wins"
          : "Checkmate — Black wins";
      case "resignation":
        return result.winner === "white"
          ? "Black resigned — White wins"
          : "White resigned — Black wins";
      case "stalemate":
        return "Stalemate — Draw";
      case "draw":
        return `Draw — ${result.reason}`;
    }
  }

  capturedPieces(capturer: PieceColor, upToPly: number): Piece[] {
    return this.game.recordedMoves
      .filter((r) => r.ply < upToPly && r.color === capturer && r.captured)
      .map((r) => r.captured!);
  }

  private async maybePlayBotMove(): Promise<void> {
    if (
      this.mode !== "vsBot" ||
      this.game.activeColor !== "black" ||
      this.game.result.type !== "ongoing" ||
      this.isThinking
    ) {
      return;
    }

    this.isThinking = true;
    this.botEngineError = null;
    this.notify();

    const start = performance.now();
    const plyAtRequest = this.game.recordedMoves.length;

    try {
      let applied = false;
      let lastUci = "";

      for (let attempt = 0; attempt < 2 && !applied; attempt++) {
        if (this.game.recordedMoves.length !== plyAtRequest) return;

        const snapshot = this.game.copy();
        const move = await fetchBotMove(snapshot, this.botDifficulty);
        lastUci = move ? moveUci(move) : "";

        if (
          this.mode !== "vsBot" ||
          this.game.activeColor !== "black" ||
          this.game.result.type !== "ongoing" ||
          this.game.recordedMoves.length !== plyAtRequest
        ) {
          return;
        }

        if (move && this.game.applyMove(move)) {
          applied = true;
          break;
        }
      }

      const minMs = difficultyMinThinkMs(this.botDifficulty);
      const elapsed = performance.now() - start;
      if (elapsed < minMs) {
        await sleep(minMs - elapsed);
      }

      if (applied) {
        this.notify();
        return;
      }

      if (this.game.recordedMoves.length !== plyAtRequest) return;

      this.botEngineError = lastUci
        ? `Engine move (${lastUci}) was not legal here — try Undo or New Game.`
        : "Engine did not return a move. Try again.";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.botEngineError = msg || "Cannot reach the chess engine.";
    } finally {
      this.isThinking = false;
      this.notify();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
