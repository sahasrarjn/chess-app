import { GameController } from "../game/gameController";
import { squaresEqual } from "../engine/chessGame";
import {
  BOARD_SIZE,
  pieceAssetName,
  type Piece,
  standardFileLabel,
  standardRankLabel,
  type BotDifficulty,
  type GameMode,
} from "../engine/types";

const PIECE_BASE = `${import.meta.env.BASE_URL}pieces/`;

export function renderGame(
  root: HTMLElement,
  mode: GameMode,
  difficulty: BotDifficulty,
  onBack: () => void
): () => void {
  const ctrl = new GameController(mode, difficulty);
  let rafScheduled = false;
  let gameOverShown = false;

  const scheduleRender = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      paint();
    });
  };

  const paint = () => {
    root.innerHTML = "";
    const screen = el("div", "game-screen");

    const header = el("div", "game-header");
    const back = el("button", "back", "← Back");
    back.onclick = onBack;
    header.appendChild(back);
    header.appendChild(
      el("h2", "", mode === "vsBot" ? `Play vs Bot (${difficulty})` : "Play with Friend")
    );
    const flip = el("button", "", "Flip");
    flip.onclick = () => {
      ctrl.toggleBoardFlip();
      scheduleRender();
    };
    header.appendChild(flip);
    screen.appendChild(header);

    const displayedPly = ctrl.previewPly ?? ctrl.livePly;
    const capWhite = ctrl.capturedPieces("white", displayedPly);
    const capBlack = ctrl.capturedPieces("black", displayedPly);

    const capBar = el("div", "captured-bar");
    capBar.appendChild(renderCaptured(capBlack, "Black"));
    capBar.appendChild(renderCaptured(capWhite, "White"));
    screen.appendChild(capBar);

    const status = el("div", `status-bar${ctrl.botEngineError ? " error" : ""}`);
    status.textContent = ctrl.statusText();
    screen.appendChild(status);

    const boardWrap = el("div", "board-wrap");
    const frame = el("div", "board-frame");
    boardWrap.appendChild(frame);

    const grid = el("div", "board-grid");
    const snap = ctrl.displaySnapshot;
    const lastMove = snap.lastMove;

    const rows = ctrl.boardFlipped
      ? [...Array(BOARD_SIZE).keys()].reverse()
      : [...Array(BOARD_SIZE).keys()];
    const cols = ctrl.boardFlipped
      ? [...Array(BOARD_SIZE).keys()].reverse()
      : [...Array(BOARD_SIZE).keys()];

    for (const row of rows) {
      for (const col of cols) {
        const square = { row, col };
        const isLight = (row + col) % 2 === 0;
        const btn = el("button", `square ${isLight ? "light" : "dark"}`);

        const key = ctrl.squareKey(square);
        if (ctrl.selectedSquare && squaresEqual(ctrl.selectedSquare, square)) {
          btn.classList.add("selected");
        }
        if (lastMove && (squaresEqual(lastMove.from, square) || squaresEqual(lastMove.to, square))) {
          btn.classList.add("last-move");
        }
        if (ctrl.isKingInCheck(square)) btn.classList.add("in-check");

        if (ctrl.legalTargets.has(key) && !ctrl.captureTargets.has(key)) {
          btn.appendChild(el("span", "legal-dot"));
        }
        if (ctrl.captureTargets.has(key)) {
          btn.appendChild(el("span", "capture-ring"));
        }

        const piece = ctrl.piece(square);
        if (piece) {
          const img = document.createElement("img");
          img.className = "piece-img";
          img.src = `${PIECE_BASE}${pieceAssetName(piece)}.svg`;
          img.alt = piece.kind;
          btn.appendChild(img);
        }

        const fileLabel = standardFileLabel(col);
        const rankLabel = standardRankLabel(row);
        if (fileLabel && row === (ctrl.boardFlipped ? 0 : BOARD_SIZE - 1)) {
          const c = el("span", "coord file", fileLabel);
          btn.appendChild(c);
        }
        if (rankLabel && col === (ctrl.boardFlipped ? BOARD_SIZE - 1 : 0)) {
          const c = el("span", "coord rank", rankLabel);
          btn.appendChild(c);
        }

        btn.onclick = () => {
          ctrl.handleSquareTap(square);
          scheduleRender();
        };
        grid.appendChild(btn);
      }
    }
    boardWrap.appendChild(grid);
    screen.appendChild(boardWrap);

    const moveWrap = el("div", "move-list-wrap");
    const moveList = el("div", "move-list");
    const moves = ctrl.game.recordedMoves;
    let moveNum = 1;
    for (let i = 0; i < moves.length; i++) {
      const rec = moves[i];
      if (rec.color === "white") {
        const numSpan = el("span", "move-num", `${moveNum}.`);
        moveList.appendChild(numSpan);
        moveNum++;
      }
      const entry = el("button", "move-entry", rec.san);
      if (ctrl.previewPly === rec.ply + 1 || (ctrl.previewPly == null && rec.ply === moves.length - 1)) {
        entry.classList.add("active");
      }
      const ply = rec.ply + 1;
      entry.onclick = () => {
        ctrl.goToMove(ply);
        scheduleRender();
      };
      moveList.appendChild(entry);
    }
    if (moves.length === 0) {
      moveList.appendChild(el("span", "", "No moves yet"));
    }
    moveWrap.appendChild(moveList);
    screen.appendChild(moveWrap);

    const controls = el("div", "game-controls");
    const undo = el("button", "", "Undo") as HTMLButtonElement;
    undo.disabled = ctrl.game.moveHistory.length === 0;
    undo.onclick = () => {
      ctrl.undo();
      scheduleRender();
    };
    controls.appendChild(undo);

    const histBack = el("button", "", "◀");
    histBack.onclick = () => {
      ctrl.stepBack();
      scheduleRender();
    };
    controls.appendChild(histBack);

    const histFwd = el("button", "", "▶");
    histFwd.onclick = () => {
      ctrl.stepForward();
      scheduleRender();
    };
    controls.appendChild(histFwd);

    const live = el("button", "", "Live");
    live.onclick = () => {
      ctrl.previewPly = null;
      scheduleRender();
    };
    controls.appendChild(live);

    const resign = el("button", "danger", "Resign") as HTMLButtonElement;
    resign.disabled = ctrl.game.result.type !== "ongoing";
    resign.onclick = () => {
      if (confirm("Resign this game?")) {
        ctrl.resignGame();
        scheduleRender();
      }
    };
    controls.appendChild(resign);

    const newGame = el("button", "primary", "New Game");
    newGame.onclick = () => {
      ctrl.newGame();
      scheduleRender();
    };
    controls.appendChild(newGame);

    screen.appendChild(controls);
    root.appendChild(screen);

    if (ctrl.pendingPromotion) {
      screen.appendChild(buildPromotionPanel(ctrl, scheduleRender));
    }

    if (
      ctrl.game.result.type !== "ongoing" &&
      !ctrl.pendingPromotion &&
      !gameOverShown
    ) {
      gameOverShown = true;
      showGameOverOverlay(ctrl, () => {
        gameOverShown = false;
        scheduleRender();
      });
    }
  };

  paint();

  return () => {
    /* cleanup if needed */
  };
}

function buildPromotionPanel(ctrl: GameController, rerender: () => void): HTMLElement {
  const overlay = el("div", "overlay");
  const panel = el("div", "overlay-panel");
  panel.appendChild(el("h3", "", "Promote pawn"));
  const opts = el("div", "promotion-options");
  const color = ctrl.game.activeColor === "white" ? "w" : "b";
  for (const kind of ["Q", "R", "B", "N"] as const) {
    const btn = el("button", "");
    const img = document.createElement("img");
    img.src = `${PIECE_BASE}${color}${kind}.svg`;
    img.alt = kind;
    btn.appendChild(img);
    btn.onclick = () => {
      ctrl.promote(kind);
      rerender();
    };
    opts.appendChild(btn);
  }
  const cancel = el("button", "", "Cancel");
  cancel.onclick = () => {
    ctrl.cancelPromotion();
    rerender();
  };
  panel.appendChild(opts);
  panel.appendChild(cancel);
  overlay.appendChild(panel);
  return overlay;
}

function showGameOverOverlay(ctrl: GameController, onDismiss: () => void): void {
  const overlay = el("div", "overlay");
  const panel = el("div", "overlay-panel");
  panel.appendChild(el("h3", "", "Game over"));
  panel.appendChild(el("p", "", ctrl.statusText()));
  const btn = el("button", "primary", "New Game");
  btn.onclick = () => {
    overlay.remove();
    ctrl.newGame();
    onDismiss();
  };
  const back = el("button", "", "Dismiss");
  back.onclick = () => {
    overlay.remove();
    onDismiss();
  };
  panel.appendChild(btn);
  panel.appendChild(back);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function renderCaptured(pieces: Piece[], label: string): HTMLElement {
  const wrap = el("div", "");
  const span = el("span", "", `${label}: `);
  wrap.appendChild(span);
  const row = el("div", "captured-pieces");
  for (const p of pieces) {
    const img = document.createElement("img");
    img.src = `${PIECE_BASE}${pieceAssetName(p)}.svg`;
    row.appendChild(img);
  }
  wrap.appendChild(row);
  return wrap;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
