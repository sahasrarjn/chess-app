import { pieceImgSrc } from "../assets/pieceImages";
import { SoundPlayer } from "../audio/soundPlayer";
import {
  BOARD_SIZE,
  engineFileLabel,
  engineRankLabel,
  type GameResult,
  type Square,
} from "../engine/types";
import { getGuestName, getPlayerToken } from "../online/guestIdentity";
import { MultiplayerController } from "../online/multiplayerController";
import { bindTap } from "./tapActivation";

const WS_URL = import.meta.env.VITE_MULTIPLAYER_WS_URL as string | undefined;

export function renderOnlineGame(
  root: HTMLElement,
  roomId: string,
  onBack: () => void
): () => void {
  if (!WS_URL) {
    root.innerHTML = "";
    const panel = el("div", "boot-error");
    panel.appendChild(el("p", "", "Online play isn't configured in this build."));
    const back = el("button", "", "Back");
    back.onclick = onBack;
    panel.appendChild(back);
    root.appendChild(panel);
    return () => {
      root.innerHTML = "";
    };
  }
  const screen = new OnlineGameScreen(root, roomId, onBack);
  screen.mount();
  return () => screen.destroy();
}

class OnlineGameScreen {
  private readonly ctrl: MultiplayerController;
  private readonly sound = new SoundPlayer();

  constructor(
    private readonly root: HTMLElement,
    roomId: string,
    private readonly onBack: () => void
  ) {
    this.ctrl = new MultiplayerController(
      roomId,
      { token: getPlayerToken(), name: getGuestName() },
      WS_URL as string,
      () => this.render(),
      (event) => this.sound.play(event)
    );
  }

  mount(): void {
    this.ctrl.start();
    this.render();
  }

  destroy(): void {
    this.ctrl.dispose();
    this.root.innerHTML = "";
  }

  private render(): void {
    this.root.innerHTML = "";
    const screen = el("div", "game-screen");

    const top = el("div", "game-top");
    const header = el("div", "game-header");
    const back = el("button", "back", "← Leave");
    back.onclick = () => this.onBack();
    header.appendChild(back);
    header.appendChild(el("h2", "", this.titleText()));
    const mute = el("button", "sound-toggle", this.sound.isMuted ? "🔇" : "🔊") as HTMLButtonElement;
    mute.type = "button";
    mute.title = this.sound.isMuted ? "Sound off" : "Sound on";
    mute.onclick = () => {
      this.sound.unlock();
      this.sound.toggleMuted();
      this.render();
    };
    header.appendChild(mute);
    top.appendChild(header);

    top.appendChild(el("div", "online-players", this.playersText()));

    if (this.ctrl.status === "waiting" && this.ctrl.role !== "spectator") {
      top.appendChild(this.sharePanel());
    }

    top.appendChild(el("div", "status-bar", this.statusText()));
    screen.appendChild(top);

    const boardSlot = el("div", "game-board-slot");
    const wrap = el("div", "board-wrap");
    wrap.appendChild(el("div", "board-frame"));
    const grid = el("div", "board-grid");
    this.buildBoard(grid);
    wrap.appendChild(grid);
    boardSlot.appendChild(wrap);
    screen.appendChild(boardSlot);

    const bottom = el("div", "game-bottom");
    bottom.appendChild(this.controls());
    screen.appendChild(bottom);

    this.root.appendChild(screen);
  }

  private buildBoard(grid: HTMLElement): void {
    const flip = this.ctrl.boardFlipped;
    const indices = [...Array(BOARD_SIZE).keys()];
    const rows = flip ? [...indices].reverse() : indices;
    const cols = flip ? [...indices].reverse() : indices;

    for (const row of rows) {
      for (const col of cols) {
        const square: Square = { row, col };
        const isLight = (row + col) % 2 === 0;
        const classes = ["square", isLight ? "light" : "dark"];
        if (this.ctrl.isSelected(square)) classes.push("selected");
        if (this.ctrl.isLastMoveSquare(square)) classes.push("last-move");
        if (this.ctrl.isKingInCheck(square)) classes.push("in-check");

        const btn = el("button", classes.join(" ")) as HTMLButtonElement;
        btn.type = "button";
        bindTap(btn, () => {
          this.sound.unlock();
          this.ctrl.handleSquareTap(square);
        });

        const fileLabel = engineFileLabel(col);
        const rankLabel = engineRankLabel(row);
        if (fileLabel && row === (flip ? 0 : BOARD_SIZE - 1)) {
          btn.appendChild(el("span", "coord file", fileLabel));
        }
        if (rankLabel && col === (flip ? BOARD_SIZE - 1 : 0)) {
          btn.appendChild(el("span", "coord rank", rankLabel));
        }

        if (this.ctrl.isLegalTarget(square)) {
          btn.appendChild(el("span", this.ctrl.isCaptureTarget(square) ? "capture-ring" : "legal-dot"));
        }

        const piece = this.ctrl.piece(square);
        if (piece) {
          const img = document.createElement("img");
          img.className = "piece-img";
          img.src = pieceImgSrc(piece);
          img.alt = piece.kind;
          btn.appendChild(img);
        }

        grid.appendChild(btn);
      }
    }
  }

  private sharePanel(): HTMLElement {
    const panel = el("div", "share-panel");
    panel.appendChild(el("p", "share-label", "Share this link with a friend to play:"));
    const row = el("div", "share-row");
    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.className = "share-input";
    input.value = this.ctrl.shareUrl();
    input.onclick = () => input.select();
    row.appendChild(input);
    const copy = el("button", "share-copy", "Copy") as HTMLButtonElement;
    copy.type = "button";
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(this.ctrl.shareUrl());
        copy.textContent = "Copied!";
        setTimeout(() => (copy.textContent = "Copy"), 1500);
      } catch {
        input.select();
      }
    };
    row.appendChild(copy);
    panel.appendChild(row);
    return panel;
  }

  private controls(): HTMLElement {
    const controls = el("div", "game-controls");
    const status = this.ctrl.status;
    const role = this.ctrl.role;

    if (status === "finished" && role && role !== "spectator") {
      const offered = this.ctrl.state?.rematchOfferedBy ?? null;
      const my = this.ctrl.color;
      if (offered && offered !== my) {
        const accept = el("button", "primary", "Accept rematch");
        accept.onclick = () => this.ctrl.offerRematch();
        controls.appendChild(accept);
      } else if (offered && offered === my) {
        controls.appendChild(el("span", "rematch-pending", "Rematch requested…"));
      } else {
        const rematch = el("button", "primary", "Rematch");
        rematch.onclick = () => this.ctrl.offerRematch();
        controls.appendChild(rematch);
      }
    }

    const leave = el("button", "", "Back to home");
    leave.onclick = () => this.onBack();
    controls.appendChild(leave);
    return controls;
  }

  private titleText(): string {
    if (this.ctrl.role === "spectator") return "Online (spectating)";
    return "Online";
  }

  private playersText(): string {
    const p = this.ctrl.state?.players;
    if (!p) return "Connecting…";
    const white = p.white ? p.white.name : "—";
    const black = p.black ? p.black.name : "waiting…";
    return `White: ${white}   ·   Black: ${black}`;
  }

  private statusText(): string {
    if (this.ctrl.connection === "reconnecting") return "Reconnecting…";
    if (this.ctrl.connection === "closed") return "Disconnected.";
    const s = this.ctrl.state;
    if (!s) return "Connecting…";
    if (s.status === "waiting") {
      return this.ctrl.role === "spectator" ? "Waiting for players…" : "Waiting for opponent…";
    }
    if (s.status === "finished") return this.resultText(s.result);
    // active
    const opp = s.players[s.color === "white" ? "black" : "white"];
    if (opp && !opp.connected) return "Opponent disconnected — waiting to reconnect…";
    if (this.ctrl.role === "spectator") {
      return s.yourTurn ? "" : `${activeColorText(s)} to move`;
    }
    return this.ctrl.yourTurn ? "Your move" : "Opponent's move";
  }

  private resultText(result: GameResult): string {
    const my = this.ctrl.color;
    switch (result.type) {
      case "checkmate":
        if (my) return result.winner === my ? "Checkmate — you win!" : "Checkmate — you lose.";
        return result.winner === "white" ? "Checkmate. White wins" : "Checkmate. Black wins";
      case "resignation":
        if (my) return result.winner === my ? "Opponent resigned — you win!" : "You resigned.";
        return result.winner === "white" ? "Black resigned. White wins" : "White resigned. Black wins";
      case "stalemate":
        return "Stalemate. Draw";
      case "draw":
        return `Draw: ${result.reason}`;
      case "ongoing":
        return "";
    }
  }
}

function activeColorText(s: { moves: string[] }): string {
  return s.moves.length % 2 === 0 ? "White" : "Black";
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  if (tag === "button") (node as HTMLButtonElement).type = "button";
  return node;
}
