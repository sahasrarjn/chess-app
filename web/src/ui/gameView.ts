import { pieceImgSrc } from "../assets/pieceImages";
import { SoundPlayer } from "../audio/soundPlayer";
import { GameController } from "../game/gameController";
import {
  clearSavedGame,
  restoreGameFromSnapshot,
  saveGameFromController,
  type SavedGameSnapshot,
} from "../game/savedGame";
import {
  appendGameToHistory,
  completedGameRecord,
  type CompletedGameRecord,
} from "../game/gameHistory";
import { uploadCompletedGame } from "../game/gameUploads";
import {
  type Piece,
  type BotDifficulty,
  type GameMode,
} from "../engine/types";
import { BoardView } from "./boardView";
import { MoveListView } from "./moveListView";
import { MuteButton } from "./muteButton";
import { createSettingsButton, closeSettingsPanel } from "./settingsPanel";
import { analyzeGameReview, type ReviewResult } from "../coach/review";
import type { MoveClassification } from "../coach/classify";
import { moveUci } from "../engine/types";


const HINT_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9 18h6"/><path d="M10 22h4"/>' +
  '<path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg>';

export function renderGame(
  root: HTMLElement,
  mode: GameMode,
  difficulty: BotDifficulty,
  onBack: () => void,
  saved?: SavedGameSnapshot
): () => void {
  const screen = new GameScreen(root, mode, difficulty, onBack, saved);
  screen.mount();
  return () => screen.destroy();
}

export function renderReplay(
  root: HTMLElement,
  record: CompletedGameRecord,
  onBack: () => void,
  opts?: { review?: boolean }
): () => void {
  const screen = new GameScreen(root, "localTwoPlayer", "medium", onBack, undefined, record, opts);
  screen.mount();
  return () => screen.destroy();
}

class GameScreen {
  private ctrl: GameController;
  private statusEl!: HTMLDivElement;
  private statusSpinnerEl!: HTMLSpanElement;
  private capBlackEl!: HTMLElement;
  private capWhiteEl!: HTMLElement;
  private moveList!: MoveListView;
  private undoBtn!: HTMLButtonElement;
  private retryBtn!: HTMLButtonElement;
  private backBtn!: HTMLButtonElement;
  private forwardBtn!: HTMLButtonElement;
  private liveBtn!: HTMLButtonElement;
  private resignBtn!: HTMLButtonElement;
  private historyBannerEl: HTMLElement | null = null;
  private promotionEl: HTMLElement | null = null;
  private gameOverEl: HTMLElement | null = null;
  private gameOverDismissed = false;
  private mounted = false;
  private historyRecorded = false;

  private board!: BoardView;
  private lastCapturedPly = -1;
  private lastPersistKey = "";
  private autoFlipBtn: HTMLButtonElement | null = null;
  private flipBtn: HTMLButtonElement | null = null;
  /** Friends mode on a phone: static board, pieces face each side of the table. */
  private readonly sharedScreen: boolean;
  private muteBtn!: MuteButton;
  private hintBtn!: HTMLButtonElement;
  private readonly sound = new SoundPlayer();

  // Review fields
  private reviewResult: ReviewResult | null = null;
  private reviewProgress: { done: number; total: number } | null = null;
  private reviewAbort: AbortController | null = null;
  private reviewContainerEl: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly mode: GameMode,
    private readonly difficulty: BotDifficulty,
    private readonly onBack: () => void,
    saved?: SavedGameSnapshot,
    private readonly replay?: CompletedGameRecord,
    readonly replayOpts?: { review?: boolean }
  ) {
    this.ctrl = new GameController(
      mode,
      difficulty,
      () => {
        this.update();
        this.maybePersist();
      },
      (event) => this.sound.play(event)
    );
    if (this.replay) {
      // Replay mode: restore from record as a localTwoPlayer game, never persist
      this.gameOverDismissed = true;
      const replaySaved: SavedGameSnapshot = {
        version: 1,
        mode: "localTwoPlayer",
        botDifficulty: "medium",
        moves: this.replay.moves,
        resignedBy:
          this.replay.resultType === "resignation" && this.replay.winner
            ? this.replay.winner === "white"
              ? "black"
              : "white"
            : null,
        boardFlipped: this.replay.playerColor === "black",
        autoFlipBoard: false,
      };
      const game = restoreGameFromSnapshot(replaySaved);
      if (game) {
        this.ctrl.restoreGame(game, replaySaved.boardFlipped, replaySaved.autoFlipBoard);
      }
    } else if (saved) {
      const game = restoreGameFromSnapshot(saved);
      if (game) {
        this.ctrl.restoreGame(game, saved.boardFlipped, saved.autoFlipBoard);
      }
    }
    this.sharedScreen =
      this.mode === "localTwoPlayer" && !this.replay && isPhoneViewport();
    if (this.sharedScreen) {
      // Two friends sit across the table: keep the board static (white at the
      // bottom) instead of flipping each turn; CSS rotates black's pieces.
      this.ctrl.autoFlipBoard = false;
      this.ctrl.boardFlipped = false;
    }
    this.board = new BoardView(this.ctrl, (square) => {
      this.sound.unlock();
      this.ctrl.handleSquareTap(square);
    });
    this.board.setSharedScreen(this.sharedScreen);
  }

  mount(): void {
    this.root.innerHTML = "";
    const screen = el("div", "game-screen");

    const top = el("div", "game-top");
    const header = el("div", "game-header");
    const back = el("button", "back", "← Back");
    back.onclick = () => {
      if (!this.replay && this.ctrl.game.result.type === "ongoing") {
        if (!confirm("Leave game? Your progress is saved and will resume automatically next time.")) return;
      }
      this.onBack();
    };
    header.appendChild(back);

    if (this.replay) {
      header.appendChild(el("h2", "", `Replay — ${this.replay.opponent}`));
    } else {
      header.appendChild(
        el("h2", "", this.mode === "vsBot" ? `Play vs Bot (${this.difficulty})` : "Play with Friend")
      );
      if (this.mode === "localTwoPlayer" && !this.sharedScreen) {
        this.autoFlipBtn = el("button", "auto-flip active", "Auto-flip") as HTMLButtonElement;
        this.autoFlipBtn.onclick = () => this.ctrl.toggleAutoFlipBoard();
        header.appendChild(this.autoFlipBtn);
      }
    }

    // Flipping is meaningless on the static shared screen (pieces face each side).
    if (!this.sharedScreen) {
      this.flipBtn = el("button", "", "Flip") as HTMLButtonElement;
      this.flipBtn.onclick = () => this.ctrl.toggleBoardFlip();
      header.appendChild(this.flipBtn);
    }

    this.muteBtn = new MuteButton(this.sound);
    header.appendChild(this.muteBtn.el);

    if (!this.replay) {
      this.hintBtn = el("button", "hint-toggle icon-btn") as HTMLButtonElement;
      this.hintBtn.type = "button";
      this.hintBtn.innerHTML = HINT_SVG;
      this.hintBtn.title = "Hint";
      this.hintBtn.setAttribute("aria-label", "Show a suggested move");
      this.hintBtn.onclick = () => {
        void this.ctrl.requestHint();
      };
      header.appendChild(this.hintBtn);
    }
    header.appendChild(createSettingsButton());
    top.appendChild(header);

    const capBar = el("div", "captured-bar");
    this.capBlackEl = el("div", "captured-side captured-side-black");
    this.capWhiteEl = el("div", "captured-side captured-side-white");
    capBar.appendChild(this.capBlackEl);
    capBar.appendChild(this.capWhiteEl);
    top.appendChild(capBar);

    const statusWrap = el("div", "status-wrap");
    this.statusEl = el("div", "status-bar") as HTMLDivElement;
    this.statusSpinnerEl = el("span", "status-spinner") as HTMLSpanElement;
    this.statusSpinnerEl.setAttribute("aria-hidden", "true");
    this.statusEl.appendChild(this.statusSpinnerEl);
    statusWrap.appendChild(this.statusEl);
    if (!this.replay) {
      this.historyBannerEl = el("div", "history-banner");
      this.historyBannerEl.hidden = true;
      statusWrap.appendChild(this.historyBannerEl);
    }
    top.appendChild(statusWrap);
    screen.appendChild(top);

    const boardSlot = el("div", "game-board-slot");
    boardSlot.appendChild(this.board.el);
    screen.appendChild(boardSlot);

    const bottom = el("div", "game-bottom");
    const moveWrap = el("div", "move-list-wrap");
    this.moveList = new MoveListView((ply) => this.ctrl.goToMove(ply));
    moveWrap.appendChild(this.moveList.el);
    bottom.appendChild(moveWrap);

    // Review container (hidden until review starts/completes)
    this.reviewContainerEl = el("div", "coach-review-container");
    bottom.appendChild(this.reviewContainerEl);

    const controls = el("div", "game-controls");

    if (this.replay) {
      // Replay chrome: First, ◀, ▶, Last; no Undo/Resign/New Game/Retry/Hint
      const firstBtn = el("button", "", "First") as HTMLButtonElement;
      firstBtn.onclick = () => this.ctrl.goToMove(0);
      controls.appendChild(firstBtn);

      this.backBtn = el("button", "", "◀") as HTMLButtonElement;
      this.backBtn.onclick = () => this.ctrl.stepBack();
      controls.appendChild(this.backBtn);

      this.forwardBtn = el("button", "", "▶") as HTMLButtonElement;
      this.forwardBtn.onclick = () => this.ctrl.stepForward();
      controls.appendChild(this.forwardBtn);

      this.liveBtn = el("button", "", "Last") as HTMLButtonElement;
      this.liveBtn.onclick = () => this.ctrl.returnToLive();
      controls.appendChild(this.liveBtn);

      // Analyze game button (only in replay with review enabled)
      if (this.replayOpts?.review) {
        const analyzeBtn = el("button", "", "Analyze game") as HTMLButtonElement;
        analyzeBtn.onclick = () => this.startReview();
        controls.appendChild(analyzeBtn);
      }

      // Stubs for updateControls()
      this.retryBtn = el("button", "primary retry-emphasis", "Retry Bot") as HTMLButtonElement;
      this.retryBtn.hidden = true;
      this.undoBtn = el("button", "", "Undo") as HTMLButtonElement;
      this.undoBtn.hidden = true;
      this.resignBtn = el("button", "danger", "Resign") as HTMLButtonElement;
      this.resignBtn.hidden = true;
      this.hintBtn = el("button", "hint-toggle icon-btn") as HTMLButtonElement;
      this.hintBtn.hidden = true;
    } else {
      this.retryBtn = el("button", "primary retry-emphasis", "Retry Bot") as HTMLButtonElement;
      this.retryBtn.onclick = () => this.ctrl.retryBotMove();
      this.retryBtn.hidden = true;
      controls.appendChild(this.retryBtn);

      this.undoBtn = el("button", "", "Undo") as HTMLButtonElement;
      this.undoBtn.onclick = () => this.ctrl.undo();
      controls.appendChild(this.undoBtn);

      this.backBtn = el("button", "", "◀") as HTMLButtonElement;
      this.backBtn.onclick = () => this.ctrl.stepBack();
      controls.appendChild(this.backBtn);

      this.forwardBtn = el("button", "", "▶") as HTMLButtonElement;
      this.forwardBtn.onclick = () => this.ctrl.stepForward();
      controls.appendChild(this.forwardBtn);

      this.liveBtn = el("button", "", "Live") as HTMLButtonElement;
      this.liveBtn.onclick = () => this.ctrl.returnToLive();
      controls.appendChild(this.liveBtn);

      this.resignBtn = el("button", "danger", "Resign") as HTMLButtonElement;
      this.resignBtn.onclick = () => {
        if (confirm("Resign this game?")) this.ctrl.resignGame();
      };
      controls.appendChild(this.resignBtn);

      const newGame = el("button", "primary", "New Game");
      newGame.onclick = () => this.startNewGame();
      controls.appendChild(newGame);
    }

    bottom.appendChild(controls);
    screen.appendChild(bottom);
    this.root.appendChild(screen);

    this.mounted = true;
    this.update();
  }

  destroy(): void {
    this.ctrl.dispose();
    this.reviewAbort?.abort();
    this.promotionEl?.remove();
    this.gameOverEl?.remove();
    closeSettingsPanel();
    this.root.innerHTML = "";
  }

  private update(): void {
    if (!this.mounted) return;
    if (this.autoFlipBtn) {
      this.autoFlipBtn.classList.toggle("active", this.ctrl.autoFlipBoard);
    }
    if (this.flipBtn) {
      this.flipBtn.disabled =
        this.mode === "localTwoPlayer" && this.ctrl.autoFlipBoard;
    }

    this.updateStatus();
    this.updateCaptured();
    this.board.update();
    const classifications = this.reviewResult?.moves.map((m) => m.classification as MoveClassification | undefined);
    this.moveList.update(this.ctrl.game.recordedMoves, this.ctrl.previewPly, classifications);
    this.updateControls();
    this.updateHintButton();
    this.updatePromotion();
    this.updateGameOver();
    this.updateHistoryBanner();
  }

  private updateHintButton(): void {
    if (this.replay) return; // No hint in replay mode
    const computing = this.ctrl.isComputingHint;
    this.hintBtn.disabled = computing || !this.ctrl.canRequestHint;
    this.hintBtn.classList.toggle("computing", computing);
  }

  private updateStatus(): void {
    const showBotStatus =
      this.mode === "vsBot" &&
      (this.ctrl.isThinking || this.ctrl.isBotTurn || !!this.ctrl.botEngineError);
    const showSpinner =
      this.ctrl.isThinking || (this.ctrl.isBotTurn && !this.ctrl.botEngineError);
    this.statusEl.textContent = this.ctrl.statusText();
    this.statusSpinnerEl.hidden = !showSpinner;
    this.statusEl.classList.toggle("error", false);
    this.statusEl.classList.toggle("thinking", showBotStatus);
  }

  private updateCaptured(): void {
    const ply = this.ctrl.previewPly ?? this.ctrl.livePly;
    if (ply === this.lastCapturedPly) return;
    this.lastCapturedPly = ply;

    this.capBlackEl.replaceChildren();
    this.capWhiteEl.replaceChildren();
    this.capBlackEl.appendChild(this.renderCapturedSide(this.ctrl.capturedPieces("black", ply)));
    this.capWhiteEl.appendChild(this.renderCapturedSide(this.ctrl.capturedPieces("white", ply)));
  }

  private renderCapturedSide(pieces: Piece[]): HTMLElement {
    const row = el("div", "captured-pieces");
    for (const p of pieces) {
      const img = document.createElement("img");
      img.src = pieceImgSrc(p);
      img.alt = p.kind;
      row.appendChild(img);
    }
    return row;
  }


  private updateHistoryBanner(): void {
    if (!this.historyBannerEl || this.replay) return;
    const ply = this.ctrl.previewPly;
    this.historyBannerEl.hidden = ply === null;
    if (ply !== null) {
      this.historyBannerEl.replaceChildren();
      const text = el("span", "history-banner-text", `Viewing move ${ply}`);
      const btn = el("button", "primary history-banner-live", "Live ▶") as HTMLButtonElement;
      btn.onclick = () => this.ctrl.returnToLive();
      this.historyBannerEl.appendChild(text);
      this.historyBannerEl.appendChild(btn);
    }
  }

  private updateControls(): void {
    const canBrowse = this.ctrl.canBrowseHistory;
    const viewPly = this.ctrl.previewPly ?? this.ctrl.livePly;
    this.backBtn.disabled = !canBrowse || viewPly <= 0;
    this.forwardBtn.disabled = !canBrowse || viewPly >= this.ctrl.livePly;

    if (this.replay) {
      // In replay: liveBtn is "Last" — disabled when at live position
      this.liveBtn.disabled = this.ctrl.previewPly == null;
      return;
    }

    const gameOver = this.ctrl.game.result.type !== "ongoing";
    this.undoBtn.disabled = gameOver || this.ctrl.game.moveHistory.length === 0;
    this.resignBtn.disabled = gameOver;
    this.retryBtn.hidden = !this.ctrl.canRetryBot;
    this.retryBtn.disabled = !this.ctrl.canRetryBot;
    this.liveBtn.disabled = this.ctrl.previewPly == null;
    this.liveBtn.classList.toggle("primary", this.ctrl.previewPly !== null);
  }

  private updatePromotion(): void {
    if (this.ctrl.pendingPromotion) {
      if (!this.promotionEl) {
        this.promotionEl = this.buildPromotionPanel();
        document.body.appendChild(this.promotionEl);
      }
    } else if (this.promotionEl) {
      this.promotionEl.remove();
      this.promotionEl = null;
    }
  }

  private updateGameOver(): void {
    const shouldShow =
      this.ctrl.game.result.type !== "ongoing" &&
      !this.ctrl.pendingPromotion &&
      !this.gameOverDismissed;

    if (shouldShow) {
      if (!this.gameOverEl) {
        this.gameOverEl = this.buildGameOverOverlay();
        document.body.appendChild(this.gameOverEl);
      }
    } else {
      this.removeGameOverOverlay();
    }
  }

  private dismissGameOver(): void {
    this.gameOverDismissed = true;
    this.removeGameOverOverlay();
    this.update();
  }

  private startNewGame(): void {
    this.gameOverDismissed = false;
    this.historyRecorded = false;
    this.removeGameOverOverlay();
    clearSavedGame();
    this.lastPersistKey = "";
    this.ctrl.newGame();
    this.sound.unlock();
    this.sound.play("game-start");
  }

  private maybePersist(): void {
    if (!this.mounted) return;
    if (this.replay) return; // Replay mode: never persist
    const key = [
      this.ctrl.livePly,
      this.ctrl.game.result.type,
      this.ctrl.game.resignedBy,
      this.ctrl.boardFlipped,
      this.ctrl.autoFlipBoard,
    ].join("|");
    if (key === this.lastPersistKey) return;
    this.lastPersistKey = key;
    saveGameFromController(this.ctrl);
    this.maybeRecordHistory();
  }

  private maybeRecordHistory(): void {
    if (this.historyRecorded || this.ctrl.game.result.type === "ongoing") return;
    const record = completedGameRecord({
      game: this.ctrl.game,
      mode: this.mode,
      difficulty: this.mode === "vsBot" ? this.difficulty : null,
      playerColor: this.mode === "vsBot" ? "white" : null,
      opponent: this.mode === "vsBot" ? `Bot (${this.difficulty})` : "Friend (local)",
    });
    if (!record) return;
    const appended = appendGameToHistory(record);
    if (appended) {
      // Only mark recorded when append succeeded; leave false on quota failure
      // so a later notify can retry.
      this.historyRecorded = true;
      void uploadCompletedGame(record); // fire-and-forget, never throws
    }
  }

  private removeGameOverOverlay(): void {
    this.gameOverEl?.remove();
    this.gameOverEl = null;
  }

  private startReview(): void {
    if (this.reviewAbort) return; // already running
    this.reviewResult = null;
    this.reviewProgress = { done: 0, total: 0 };
    this.reviewAbort = new AbortController();
    const signal = this.reviewAbort.signal;

    const moves = this.ctrl.game.recordedMoves.map((r) => moveUci(r.move));
    this.updateReview();

    void analyzeGameReview(
      moves,
      (done, total) => {
        this.reviewProgress = { done, total };
        this.updateReview();
        this.update(); // update move list badges mid-run? only after complete
      },
      signal
    ).then((result) => {
      this.reviewResult = result;
      this.reviewProgress = null;
      this.reviewAbort = null;
      this.updateReview();
      this.update(); // re-render move list with badges
    }).catch((err) => {
      this.reviewAbort = null;
      this.reviewProgress = null;
      if (err instanceof DOMException && err.name === "AbortError") {
        // cancelled — show nothing
      } else {
        // show error
        this.reviewResult = null;
      }
      this.updateReview();
    });
  }

  private cancelReview(): void {
    this.reviewAbort?.abort();
    this.reviewAbort = null;
    this.reviewProgress = null;
    this.updateReview();
  }

  private updateReview(): void {
    if (!this.reviewContainerEl) return;
    const container = this.reviewContainerEl;
    container.replaceChildren();

    if (this.reviewProgress) {
      // Show progress bar
      const { done, total } = this.reviewProgress;
      const pct = total > 0 ? (done / total) * 100 : 0;

      const progressEl = el("div", "coach-progress");
      const track = el("div", "coach-progress-track");
      const fill = el("div", "coach-progress-fill");
      fill.style.width = `${pct.toFixed(1)}%`;
      track.appendChild(fill);

      const row = el("div", "coach-progress-row");
      const label = el("span", "coach-progress-label", `Analyzing… ${done}/${total}`);
      const cancelBtn = el("button", "", "Cancel") as HTMLButtonElement;
      cancelBtn.onclick = () => this.cancelReview();
      row.appendChild(label);
      row.appendChild(cancelBtn);

      progressEl.appendChild(track);
      progressEl.appendChild(row);
      container.appendChild(progressEl);
      return;
    }

    if (!this.reviewResult) return;

    const { accuracy, keyMoments } = this.reviewResult;

    // Accuracy strip
    const accEl = el("div", "coach-accuracy", `White ${accuracy.white}% · Black ${accuracy.black}%`);
    container.appendChild(accEl);

    // Key moments
    if (keyMoments.length > 0) {
      const momentsEl = el("div", "coach-moments");
      const h4 = document.createElement("h4");
      h4.textContent = "Key moments";
      momentsEl.appendChild(h4);

      for (const km of keyMoments) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "coach-moment-row";

        const plySpan = el("span", "coach-moment-ply", `#${km.ply}`);
        const moveSpan = el("span", "coach-moment-move", km.uci);
        const swingCp = (km.swing / 100).toFixed(1);
        const swingSpan = el("span", "coach-moment-swing", `−${swingCp}`);

        const badge = document.createElement("span");
        badge.className = `coach-badge coach-badge--${km.classification}`;
        badge.textContent = km.classification === "inaccuracy" ? "?!" : km.classification === "mistake" ? "?" : "??";

        const bestSpan = km.bestMoveUci ? el("span", "coach-moment-best", `best: ${km.bestMoveUci}`) : null;

        row.appendChild(plySpan);
        row.appendChild(moveSpan);
        row.appendChild(swingSpan);
        row.appendChild(badge);
        if (bestSpan) row.appendChild(bestSpan);

        row.onclick = () => this.ctrl.goToMove(km.ply);
        momentsEl.appendChild(row);
      }

      container.appendChild(momentsEl);
    }
  }

  private buildPromotionPanel(): HTMLElement {
    const overlay = el("div", "overlay");
    const panel = el("div", "overlay-panel");
    panel.appendChild(el("h3", "", "Promote pawn"));
    const opts = el("div", "promotion-options");
    const color = this.ctrl.game.activeColor;
    for (const kind of ["Q", "R", "B", "N"] as const) {
      const btn = el("button", "");
      const img = document.createElement("img");
      img.src = pieceImgSrc({ kind, color });
      img.alt = kind;
      btn.appendChild(img);
      btn.onclick = () => this.ctrl.promote(kind);
      opts.appendChild(btn);
    }
    const cancel = el("button", "", "Cancel");
    cancel.onclick = () => this.ctrl.cancelPromotion();
    panel.appendChild(opts);
    panel.appendChild(cancel);
    overlay.appendChild(panel);
    return overlay;
  }

  private buildGameOverOverlay(): HTMLElement {
    const overlay = el("div", "overlay");
    overlay.onclick = (ev) => {
      if (ev.target === overlay) this.dismissGameOver();
    };
    const panel = el("div", "overlay-panel");
    panel.onclick = (ev) => ev.stopPropagation();
    panel.appendChild(el("h3", "", this.ctrl.gameOverTitle()));
    panel.appendChild(el("p", "", this.ctrl.statusText()));
    const btn = el("button", "primary", "New Game");
    btn.onclick = () => this.startNewGame();
    const back = el("button", "", "Dismiss");
    back.onclick = () => this.dismissGameOver();

    // Review button (available from game-over overlay)
    const reviewBtn = el("button", "", "Review") as HTMLButtonElement;
    reviewBtn.onclick = () => {
      this.dismissGameOver();
      this.startReview();
    };
    panel.appendChild(btn);
    panel.appendChild(reviewBtn);
    panel.appendChild(back);
    overlay.appendChild(panel);
    return overlay;
  }
}

/** Matches the phone breakpoint in styles.css (max-width: 599px). */
function isPhoneViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 599px)").matches
  );
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  if (tag === "button") (node as HTMLButtonElement).type = "button";
  return node;
}
