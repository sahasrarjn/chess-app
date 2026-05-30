import { chooseMinimaxMove } from "../bot/chessBot";
import { trackBotMove, trackBotMoveError, trackBotRetry } from "../analytics/botAnalytics";
import { chooseBotMove } from "../bot/chooseBotMove";
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
import { toFEN } from "../engine/fen";

export type GameUpdateListener = () => void;

export class GameController {
  game = new ChessGame();
  selectedSquare: Square | null = null;
  legalTargets = new Set<string>();
  captureTargets = new Set<string>();
  pendingPromotion: { from: Square; to: Square } | null = null;
  isThinking = false;
  boardFlipped = false;
  /** Pass-and-play: rotate board for the side to move (default on). */
  autoFlipBoard = true;
  previewPly: number | null = null;
  botEngineError: string | null = null;
  revision = 0;
  private botMoveToken = 0;
  private botAbort: AbortController | null = null;

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

  get canBrowseHistory(): boolean {
    return this.livePly > 0;
  }

  get canRetryBot(): boolean {
    if (
      this.mode !== "vsBot" ||
      this.botEngineError == null ||
      this.game.result.type !== "ongoing" ||
      this.isThinking ||
      this.isBrowsingHistory
    ) {
      return false;
    }
    if (this.game.activeColor === "black") return true;
    // Fallback move was already applied; allow undo-and-retry on white's turn.
    const last = this.game.recordedMoves.at(-1);
    return this.game.activeColor === "white" && last?.color === "black";
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
    if (
      this.mode === "localTwoPlayer" &&
      this.autoFlipBoard &&
      !this.isBrowsingHistory
    ) {
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
    this.cancelBotRequest();
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

  dispose(): void {
    this.cancelBotRequest();
  }

  newGame(): void {
    this.cancelBotRequest();
    this.game = new ChessGame();
    this.clearSelection();
    this.pendingPromotion = null;
    this.isThinking = false;
    this.boardFlipped = false;
    this.autoFlipBoard = true;
    this.previewPly = null;
    this.botEngineError = null;
    this.notify();
  }

  restoreGame(
    game: ChessGame,
    boardFlipped: boolean,
    autoFlipBoard: boolean
  ): void {
    this.cancelBotRequest();
    this.game = game;
    this.clearSelection();
    this.pendingPromotion = null;
    this.isThinking = false;
    this.boardFlipped = boardFlipped;
    this.autoFlipBoard = autoFlipBoard;
    this.previewPly = null;
    this.botEngineError = null;
    this.notify();
    if (this.isBotTurn) void this.maybePlayBotMove();
  }

  toggleBoardFlip(): void {
    this.boardFlipped = !this.boardFlipped;
    this.notify();
  }

  toggleAutoFlipBoard(): void {
    this.autoFlipBoard = !this.autoFlipBoard;
    if (
      this.autoFlipBoard &&
      this.mode === "localTwoPlayer" &&
      !this.isBrowsingHistory
    ) {
      this.boardFlipped = this.game.activeColor === "black";
    }
    this.notify();
  }

  retryBotMove(): void {
    if (!this.canRetryBot) return;
    trackBotRetry({
      difficulty: this.botDifficulty,
      ply: this.game.recordedMoves.length,
      previousError: this.botEngineError,
    });
    this.botEngineError = null;
    if (this.game.activeColor === "white") {
      this.game.undoLastMove();
    }
    void this.maybePlayBotMove();
  }

  goToMove(ply: number): void {
    const before = this.previewPly;
    if (ply >= this.livePly) {
      this.previewPly = null;
    } else {
      this.previewPly = ply;
    }
    if (this.previewPly !== before) {
      this.clearSelection();
    } else {
      this.notify();
    }
  }

  returnToLive(): void {
    if (this.previewPly == null) return;
    this.previewPly = null;
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
    if (this.isBrowsingHistory) {
      return `Reviewing move ${this.previewPly} of ${this.livePly}`;
    }

    const result = this.game.result;
    switch (result.type) {
      case "ongoing":
        if (this.botEngineError && this.mode === "vsBot") return this.botEngineError;
        if (this.isThinking) return "Bot is thinking…";
        if (this.game.isInCheck(this.game.activeColor)) {
          return this.game.activeColor === "white"
            ? "White is in check"
            : "Black is in check";
        }
        return this.game.activeColor === "white" ? "White to move" : "Black to move";
      case "checkmate":
        return result.winner === "white"
          ? "Checkmate. White wins"
          : "Checkmate. Black wins";
      case "resignation":
        return result.winner === "white"
          ? "Black resigned. White wins"
          : "White resigned. Black wins";
      case "stalemate":
        return "Stalemate. Draw";
      case "draw":
        return `Draw: ${result.reason}`;
    }
  }

  capturedPieces(capturer: PieceColor, upToPly: number): Piece[] {
    return this.game.recordedMoves
      .filter((r) => r.ply < upToPly && r.color === capturer && r.captured)
      .map((r) => r.captured!);
  }

  private cancelBotRequest(): void {
    this.botMoveToken++;
    this.botAbort?.abort();
    this.botAbort = null;
    this.isThinking = false;
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

    const token = ++this.botMoveToken;
    this.botAbort?.abort();
    const abort = new AbortController();
    this.botAbort = abort;

    this.isThinking = true;
    this.botEngineError = null;
    this.notify();

    const start = performance.now();
    const plyAtRequest = this.game.recordedMoves.length;
    const fenAtRequest = toFEN(this.game);

    try {
      if (token !== this.botMoveToken) return;
      if (this.game.recordedMoves.length !== plyAtRequest) return;

      const snapshot = this.game.copy();
      let outcome = await chooseBotMove(
        snapshot,
        this.botDifficulty,
        abort.signal
      );

      if (
        token !== this.botMoveToken ||
        this.mode !== "vsBot" ||
        this.game.activeColor !== "black" ||
        this.game.result.type !== "ongoing" ||
        this.game.recordedMoves.length !== plyAtRequest
      ) {
        return;
      }

      let move = outcome.move;
      let usedBuiltin = outcome.source === "builtin";
      let serverError = outcome.serverError;
      let serverUci = outcome.serverUci;

      if (move && !this.game.applyMove(move)) {
        if (outcome.source === "server") {
          const badUci = moveUci(move);
          serverUci = serverUci ?? badUci;
          const local = chooseMinimaxMove(this.game, this.botDifficulty);
          if (local && this.game.applyMove(local)) {
            move = local;
            usedBuiltin = true;
            serverError =
              serverError ?? `Server move (${badUci}) was not legal here`;
          } else {
            move = null;
          }
        } else {
          move = null;
        }
      }

      const minMs = difficultyMinThinkMs(this.botDifficulty);
      const elapsed = performance.now() - start;
      if (elapsed < minMs) {
        await sleep(minMs - elapsed);
      }

      if (token !== this.botMoveToken) return;

      if (move) {
        if (usedBuiltin && serverError) {
          console.debug("Bot used built-in fallback:", serverError);
        }
        trackBotMove({
          source: usedBuiltin ? "builtin" : "server",
          difficulty: this.botDifficulty,
          elapsedMs: performance.now() - start,
          ply: plyAtRequest,
          serverError: usedBuiltin ? serverError : undefined,
          serverUci: usedBuiltin ? serverUci : serverUci ?? moveUci(move),
          appliedUci: moveUci(move),
          fen: outcome.fen,
        });
        this.notify();
        return;
      }

      if (this.game.recordedMoves.length !== plyAtRequest) return;

      const errorMsg =
        serverError ?? "Could not find a bot move. Try Retry Bot or Undo.";
      trackBotMoveError({
        source: "builtin",
        difficulty: this.botDifficulty,
        elapsedMs: performance.now() - start,
        ply: plyAtRequest,
        serverError,
        serverUci,
        fen: outcome.fen,
        error: errorMsg,
      });
      this.botEngineError = errorMsg;
    } catch (err) {
      if (token !== this.botMoveToken || abort.signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;

      if (this.game.recordedMoves.length === plyAtRequest) {
        const local = chooseMinimaxMove(this.game, this.botDifficulty);
        if (local && this.game.applyMove(local)) {
          const detail =
            err instanceof DOMException && err.name === "TimeoutError"
              ? "Engine timed out"
              : err instanceof Error
                ? err.message
                : "Engine unreachable";
          console.debug("Bot used built-in fallback:", detail);
          trackBotMove({
            source: "builtin",
            difficulty: this.botDifficulty,
            elapsedMs: performance.now() - start,
            ply: plyAtRequest,
            serverError: detail,
            appliedUci: moveUci(local),
            fen: fenAtRequest,
          });
          this.notify();
          return;
        }
      }

      const msg = err instanceof Error ? err.message : String(err);
      const errorMsg =
        err instanceof DOMException && err.name === "TimeoutError"
          ? "Engine request timed out. Try again."
          : msg || "Cannot reach the chess engine.";
      trackBotMoveError({
        source: "builtin",
        difficulty: this.botDifficulty,
        elapsedMs: performance.now() - start,
        ply: plyAtRequest,
        error: errorMsg,
        fen: fenAtRequest,
      });
      this.botEngineError = errorMsg;
    } finally {
      if (token === this.botMoveToken) {
        this.botAbort = null;
        this.isThinking = false;
        this.notify();
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
