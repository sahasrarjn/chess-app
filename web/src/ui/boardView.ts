import { pieceImgSrc } from "../assets/pieceImages";
import { BOARD_SIZE, engineFileLabel, engineRankLabel, type Piece, type Square } from "../engine/types";
import { bindTap } from "./tapActivation";

/**
 * Read-only board state a {@link BoardView} renders. Both the offline
 * GameController and the online MultiplayerController implement it, so the
 * board grid + incremental diffing live in exactly one place.
 */
export interface BoardModel {
  boardFlipped: boolean;
  piece(s: Square): Piece | null;
  isSelected(s: Square): boolean;
  isLegalTarget(s: Square): boolean;
  isCaptureTarget(s: Square): boolean;
  isLastMoveSquare(s: Square): boolean;
  isKingInCheck(s: Square): boolean;
  isHintSquare(s: Square): boolean;
}

type Cell = {
  btn: HTMLButtonElement;
  img: HTMLImageElement | null;
  dot: HTMLSpanElement | null;
  ring: HTMLSpanElement | null;
};

/** Renders the 10x10 board and updates it in place (no full teardown). */
export class BoardView {
  readonly el: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private cells = new Map<string, Cell>();
  private lastFlip = false;

  constructor(
    private readonly model: BoardModel,
    private readonly onSquareTap: (s: Square) => void
  ) {
    this.el = div("board-wrap");
    this.el.appendChild(div("board-frame"));
    this.grid = div("board-grid");
    this.el.appendChild(this.grid);
    this.rebuildGrid();
  }

  private key(row: number, col: number): string {
    return `${row},${col}`;
  }

  /**
   * Shared-screen (friends-on-phone) mode: keep the board static and let CSS
   * rotate the far side's pieces 180° so each player reads their own pieces.
   */
  setSharedScreen(on: boolean): void {
    this.grid.classList.toggle("shared-screen", on);
  }

  private rebuildGrid(): void {
    this.cells.clear();
    this.grid.replaceChildren();

    const order = [...Array(BOARD_SIZE).keys()];
    const rows = this.model.boardFlipped ? [...order].reverse() : order;
    const cols = this.model.boardFlipped ? [...order].reverse() : order;

    for (const row of rows) {
      for (const col of cols) {
        const isLight = (row + col) % 2 === 0;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `square ${isLight ? "light" : "dark"}`;
        const square: Square = { row, col };
        bindTap(btn, () => this.onSquareTap(square));

        const fileLabel = engineFileLabel(col);
        const rankLabel = engineRankLabel(row);
        if (fileLabel && row === (this.model.boardFlipped ? 0 : BOARD_SIZE - 1)) {
          btn.appendChild(span("coord file", fileLabel));
        }
        if (rankLabel && col === (this.model.boardFlipped ? BOARD_SIZE - 1 : 0)) {
          btn.appendChild(span("coord rank", rankLabel));
        }

        this.cells.set(this.key(row, col), { btn, img: null, dot: null, ring: null });
        this.grid.appendChild(btn);
      }
    }
    this.lastFlip = this.model.boardFlipped;
  }

  update(): void {
    if (this.model.boardFlipped !== this.lastFlip) this.rebuildGrid();

    for (const [key, cell] of this.cells) {
      const [row, col] = key.split(",").map(Number);
      const square: Square = { row, col };
      const isLight = (row + col) % 2 === 0;

      const classes = ["square", isLight ? "light" : "dark"];
      if (this.model.isSelected(square)) classes.push("selected");
      if (this.model.isLastMoveSquare(square)) classes.push("last-move");
      if (this.model.isKingInCheck(square)) classes.push("in-check");
      if (this.model.isHintSquare(square)) classes.push("hint");
      const cn = classes.join(" ");
      if (cell.btn.className !== cn) cell.btn.className = cn;

      const showRing = this.model.isCaptureTarget(square);
      const showDot = !showRing && this.model.isLegalTarget(square);

      if (showDot && !cell.dot) {
        cell.dot = span("legal-dot");
        cell.btn.appendChild(cell.dot);
      } else if (!showDot && cell.dot) {
        cell.dot.remove();
        cell.dot = null;
      }

      if (showRing && !cell.ring) {
        cell.ring = span("capture-ring");
        cell.btn.appendChild(cell.ring);
      } else if (!showRing && cell.ring) {
        cell.ring.remove();
        cell.ring = null;
      }

      const piece = this.model.piece(square);
      const asset = piece ? pieceImgSrc(piece) : null;
      if (!piece) {
        if (cell.img) {
          cell.img.remove();
          cell.img = null;
        }
      } else if (!cell.img) {
        const img = document.createElement("img");
        img.className = "piece-img";
        img.src = asset!;
        img.alt = piece.kind;
        img.dataset.color = piece.color;
        cell.btn.appendChild(img);
        cell.img = img;
      } else if (cell.img.src !== asset) {
        cell.img.src = asset!;
        cell.img.alt = piece.kind;
        cell.img.dataset.color = piece.color;
      }
    }
  }
}

function div(className: string): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

function span(className: string, text?: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = className;
  if (text) node.textContent = text;
  return node;
}
