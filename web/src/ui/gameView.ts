import { GameController } from "../game/gameController";
import { squaresEqual } from "../engine/chessGame";
import {
  BOARD_SIZE,
  pieceAssetName,
  type Piece,
  engineFileLabel,
  engineRankLabel,
  type BotDifficulty,
  type GameMode,
  type Square,
} from "../engine/types";

const PIECE_BASE = `${import.meta.env.BASE_URL}pieces/`;

type SquareCell = {
  btn: HTMLButtonElement;
  pieceImg: HTMLImageElement | null;
  dot: HTMLSpanElement | null;
  ring: HTMLSpanElement | null;
};

export function renderGame(
  root: HTMLElement,
  mode: GameMode,
  difficulty: BotDifficulty,
  onBack: () => void
): () => void {
  const screen = new GameScreen(root, mode, difficulty, onBack);
  screen.mount();
  return () => screen.destroy();
}

class GameScreen {
  private ctrl: GameController;
  private statusEl!: HTMLDivElement;
  private capBlackEl!: HTMLElement;
  private capWhiteEl!: HTMLElement;
  private gridEl!: HTMLDivElement;
  private moveListEl!: HTMLDivElement;
  private undoBtn!: HTMLButtonElement;
  private retryBtn!: HTMLButtonElement;
  private resignBtn!: HTMLButtonElement;
  private promotionEl: HTMLElement | null = null;
  private gameOverEl: HTMLElement | null = null;
  private gameOverShown = false;

  private squareCells = new Map<string, SquareCell>();
  private displayedRows: number[] = [];
  private displayedCols: number[] = [];
  private lastMoveListLen = 0;
  private lastCapturedPly = -1;
  private lastFlip = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly mode: GameMode,
    private readonly difficulty: BotDifficulty,
    private readonly onBack: () => void
  ) {
    this.ctrl = new GameController(mode, difficulty, () => this.update());
  }

  mount(): void {
    this.root.innerHTML = "";
    const screen = el("div", "game-screen");

    const header = el("div", "game-header");
    const back = el("button", "back", "← Back");
    back.onclick = () => this.onBack();
    header.appendChild(back);
    header.appendChild(
      el("h2", "", this.mode === "vsBot" ? `Play vs Bot (${this.difficulty})` : "Play with Friend")
    );
    const flip = el("button", "", "Flip");
    flip.onclick = () => this.ctrl.toggleBoardFlip();
    header.appendChild(flip);
    screen.appendChild(header);

    const capBar = el("div", "captured-bar");
    this.capBlackEl = el("div", "captured-side captured-side-black");
    this.capWhiteEl = el("div", "captured-side captured-side-white");
    capBar.appendChild(this.capBlackEl);
    capBar.appendChild(this.capWhiteEl);
    screen.appendChild(capBar);

    this.statusEl = el("div", "status-bar") as HTMLDivElement;
    screen.appendChild(this.statusEl);

    const boardWrap = el("div", "board-wrap");
    boardWrap.appendChild(el("div", "board-frame"));
    this.gridEl = el("div", "board-grid") as HTMLDivElement;
    boardWrap.appendChild(this.gridEl);
    screen.appendChild(boardWrap);

    const moveWrap = el("div", "move-list-wrap");
    this.moveListEl = el("div", "move-list") as HTMLDivElement;
    moveWrap.appendChild(this.moveListEl);
    screen.appendChild(moveWrap);

    const controls = el("div", "game-controls");
    this.undoBtn = el("button", "", "Undo") as HTMLButtonElement;
    this.undoBtn.onclick = () => this.ctrl.undo();
    controls.appendChild(this.undoBtn);

    this.retryBtn = el("button", "primary", "Retry Bot") as HTMLButtonElement;
    this.retryBtn.onclick = () => this.ctrl.retryBotMove();
    this.retryBtn.hidden = true;
    controls.appendChild(this.retryBtn);

    for (const label of ["◀", "▶", "Live"] as const) {
      const b = el("button", "", label);
      if (label === "◀") b.onclick = () => this.ctrl.stepBack();
      if (label === "▶") b.onclick = () => this.ctrl.stepForward();
      if (label === "Live") b.onclick = () => {
        this.ctrl.previewPly = null;
        this.update();
      };
      controls.appendChild(b);
    }

    this.resignBtn = el("button", "danger", "Resign") as HTMLButtonElement;
    this.resignBtn.onclick = () => {
      if (confirm("Resign this game?")) this.ctrl.resignGame();
    };
    controls.appendChild(this.resignBtn);

    const newGame = el("button", "primary", "New Game");
    newGame.onclick = () => {
      this.gameOverShown = false;
      this.gameOverEl?.remove();
      this.gameOverEl = null;
      this.ctrl.newGame();
    };
    controls.appendChild(newGame);

    screen.appendChild(controls);
    this.root.appendChild(screen);

    this.rebuildBoardGrid();
    this.update();
  }

  destroy(): void {
    this.promotionEl?.remove();
    this.gameOverEl?.remove();
    this.root.innerHTML = "";
  }

  private squareKey(row: number, col: number): string {
    return `${row},${col}`;
  }

  private rebuildBoardGrid(): void {
    this.squareCells.clear();
    this.gridEl.replaceChildren();

    this.displayedRows = this.ctrl.boardFlipped
      ? [...Array(BOARD_SIZE).keys()].reverse()
      : [...Array(BOARD_SIZE).keys()];
    this.displayedCols = this.ctrl.boardFlipped
      ? [...Array(BOARD_SIZE).keys()].reverse()
      : [...Array(BOARD_SIZE).keys()];

    for (const row of this.displayedRows) {
      for (const col of this.displayedCols) {
        const isLight = (row + col) % 2 === 0;
        const btn = el("button", `square ${isLight ? "light" : "dark"}`) as HTMLButtonElement;
        const square: Square = { row, col };
        btn.onclick = () => this.ctrl.handleSquareTap(square);

        const cell: SquareCell = { btn, pieceImg: null, dot: null, ring: null };

        const fileLabel = engineFileLabel(col);
        const rankLabel = engineRankLabel(row);
        if (fileLabel && row === (this.ctrl.boardFlipped ? 0 : BOARD_SIZE - 1)) {
          btn.appendChild(el("span", "coord file", fileLabel));
        }
        if (rankLabel && col === (this.ctrl.boardFlipped ? BOARD_SIZE - 1 : 0)) {
          btn.appendChild(el("span", "coord rank", rankLabel));
        }

        this.squareCells.set(this.squareKey(row, col), cell);
        this.gridEl.appendChild(btn);
      }
    }
    this.lastFlip = this.ctrl.boardFlipped;
  }

  private update(): void {
    if (this.ctrl.boardFlipped !== this.lastFlip) {
      this.rebuildBoardGrid();
    }

    this.updateStatus();
    this.updateCaptured();
    this.updateBoard();
    this.updateMoveList();
    this.updateControls();
    this.updatePromotion();
    this.updateGameOver();
  }

  private updateStatus(): void {
    this.statusEl.textContent = this.ctrl.statusText();
    this.statusEl.classList.toggle("error", !!this.ctrl.botEngineError);
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
      img.src = `${PIECE_BASE}${pieceAssetName(p)}.svg`;
      img.alt = p.kind;
      row.appendChild(img);
    }
    return row;
  }

  private updateBoard(): void {
    const snap = this.ctrl.displaySnapshot;
    const lastMove = snap.lastMove;
    const sel = this.ctrl.selectedSquare;

    for (const [key, cell] of this.squareCells) {
      const [row, col] = key.split(",").map(Number);
      const square: Square = { row, col };
      const isLight = (row + col) % 2 === 0;

      const classes = ["square", isLight ? "light" : "dark"];
      if (sel && squaresEqual(sel, square)) classes.push("selected");
      if (lastMove && (squaresEqual(lastMove.from, square) || squaresEqual(lastMove.to, square))) {
        classes.push("last-move");
      }
      if (this.ctrl.isKingInCheck(square)) classes.push("in-check");

      if (cell.btn.className !== classes.join(" ")) {
        cell.btn.className = classes.join(" ");
      }

      const sk = this.ctrl.squareKey(square);
      const showDot = this.ctrl.legalTargets.has(sk) && !this.ctrl.captureTargets.has(sk);
      const showRing = this.ctrl.captureTargets.has(sk);

      if (showDot && !cell.dot) {
        cell.dot = el("span", "legal-dot");
        cell.btn.appendChild(cell.dot);
      } else if (!showDot && cell.dot) {
        cell.dot.remove();
        cell.dot = null;
      }

      if (showRing && !cell.ring) {
        cell.ring = el("span", "capture-ring");
        cell.btn.appendChild(cell.ring);
      } else if (!showRing && cell.ring) {
        cell.ring.remove();
        cell.ring = null;
      }

      const piece = this.ctrl.piece(square);
      const asset = piece ? `${PIECE_BASE}${pieceAssetName(piece)}.svg` : null;

      if (!piece) {
        if (cell.pieceImg) {
          cell.pieceImg.remove();
          cell.pieceImg = null;
        }
      } else if (!cell.pieceImg) {
        cell.pieceImg = document.createElement("img");
        cell.pieceImg.className = "piece-img";
        cell.pieceImg.alt = piece.kind;
        cell.pieceImg.src = asset!;
        cell.btn.appendChild(cell.pieceImg);
      } else if (cell.pieceImg.src !== asset) {
        cell.pieceImg.src = asset!;
        cell.pieceImg.alt = piece.kind;
      }
    }
  }

  private updateMoveList(): void {
    const moves = this.ctrl.game.recordedMoves;
    const preview = this.ctrl.previewPly;

    if (moves.length < this.lastMoveListLen) {
      this.moveListEl.replaceChildren();
      this.lastMoveListLen = 0;
    }

    if (moves.length === 0 && this.lastMoveListLen === 0) {
      this.moveListEl.replaceChildren(el("span", "", "No moves yet"));
      return;
    }

    if (this.lastMoveListLen === 0 && moves.length > 0) {
      this.moveListEl.replaceChildren();
    }

    let moveNum = Math.floor(this.lastMoveListLen / 2) + 1;
    if (this.lastMoveListLen === 0) moveNum = 1;

    for (let i = this.lastMoveListLen; i < moves.length; i++) {
      const rec = moves[i];
      if (rec.color === "white") {
        this.moveListEl.appendChild(el("span", "move-num", `${moveNum}.`));
        moveNum++;
      }
      const entry = el("button", "move-entry", rec.san) as HTMLButtonElement;
      const ply = rec.ply + 1;
      entry.onclick = () => this.ctrl.goToMove(ply);
      this.moveListEl.appendChild(entry);
    }

    this.lastMoveListLen = moves.length;
    this.moveListEl.scrollTop = this.moveListEl.scrollHeight;

    const entries = this.moveListEl.querySelectorAll<HTMLButtonElement>("button.move-entry");
    entries.forEach((btn, idx) => {
      const rec = moves[idx];
      const active =
        preview === rec.ply + 1 || (preview == null && rec.ply === moves.length - 1);
      btn.classList.toggle("active", active);
    });

    const empty = this.moveListEl.querySelector("span:not(.move-num)");
    if (empty && moves.length > 0 && empty.textContent === "No moves yet") {
      empty.remove();
    }
  }

  private updateControls(): void {
    this.undoBtn.disabled = this.ctrl.game.moveHistory.length === 0;
    this.resignBtn.disabled = this.ctrl.game.result.type !== "ongoing";
    this.retryBtn.hidden = !this.ctrl.canRetryBot;
    this.retryBtn.disabled = !this.ctrl.canRetryBot;
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
    if (
      this.ctrl.game.result.type !== "ongoing" &&
      !this.ctrl.pendingPromotion &&
      !this.gameOverShown
    ) {
      this.gameOverShown = true;
      this.gameOverEl = this.buildGameOverOverlay();
      document.body.appendChild(this.gameOverEl);
    }
  }

  private buildPromotionPanel(): HTMLElement {
    const overlay = el("div", "overlay");
    const panel = el("div", "overlay-panel");
    panel.appendChild(el("h3", "", "Promote pawn"));
    const opts = el("div", "promotion-options");
    const color = this.ctrl.game.activeColor === "white" ? "w" : "b";
    for (const kind of ["Q", "R", "B", "N"] as const) {
      const btn = el("button", "");
      const img = document.createElement("img");
      img.src = `${PIECE_BASE}${color}${kind}.svg`;
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
    const panel = el("div", "overlay-panel");
    panel.appendChild(el("h3", "", "Game over"));
    panel.appendChild(el("p", "", this.ctrl.statusText()));
    const btn = el("button", "primary", "New Game");
    btn.onclick = () => {
      overlay.remove();
      this.gameOverEl = null;
      this.gameOverShown = false;
      this.ctrl.newGame();
    };
    const back = el("button", "", "Dismiss");
    back.onclick = () => {
      overlay.remove();
      this.gameOverEl = null;
      this.gameOverShown = false;
      this.update();
    };
    panel.appendChild(btn);
    panel.appendChild(back);
    overlay.appendChild(panel);
    return overlay;
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
