import { SoundPlayer } from "../audio/soundPlayer";
import type { GameResult, Square } from "../engine/types";
import { getGuestName, getPlayerToken } from "../online/guestIdentity";
import { MultiplayerController } from "../online/multiplayerController";
import { BoardView } from "./boardView";
import { MuteButton } from "./muteButton";

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
  private readonly board: BoardView;

  private titleEl!: HTMLElement;
  private muteBtn!: MuteButton;
  private playersEl!: HTMLElement;
  private sharePanel!: HTMLElement;
  private shareInput!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private controlsEl!: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    roomId: string,
    private readonly onBack: () => void
  ) {
    this.ctrl = new MultiplayerController(
      roomId,
      { token: getPlayerToken(), name: getGuestName() },
      WS_URL as string,
      () => this.update(),
      (event) => this.sound.play(event)
    );
    this.board = new BoardView(this.ctrl, (square: Square) => {
      this.sound.unlock();
      this.ctrl.handleSquareTap(square);
    });
  }

  mount(): void {
    this.root.innerHTML = "";
    const screen = el("div", "game-screen");

    const top = el("div", "game-top");
    const header = el("div", "game-header");
    const back = el("button", "back", "← Leave");
    back.onclick = () => this.onBack();
    header.appendChild(back);
    this.titleEl = el("h2", "", "Online");
    header.appendChild(this.titleEl);
    this.muteBtn = new MuteButton(this.sound);
    header.appendChild(this.muteBtn.el);
    top.appendChild(header);

    this.playersEl = el("div", "online-players");
    top.appendChild(this.playersEl);

    this.sharePanel = el("div", "share-panel");
    this.sharePanel.appendChild(el("p", "share-label", "Share this link with a friend to play:"));
    const shareRow = el("div", "share-row");
    this.shareInput = document.createElement("input");
    this.shareInput.type = "text";
    this.shareInput.readOnly = true;
    this.shareInput.className = "share-input";
    this.shareInput.onclick = () => this.shareInput.select();
    shareRow.appendChild(this.shareInput);
    const copy = el("button", "share-copy", "Copy") as HTMLButtonElement;
    copy.type = "button";
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(this.ctrl.shareUrl());
        copy.textContent = "Copied!";
        setTimeout(() => (copy.textContent = "Copy"), 1500);
      } catch {
        this.shareInput.select();
      }
    };
    shareRow.appendChild(copy);
    this.sharePanel.appendChild(shareRow);
    top.appendChild(this.sharePanel);

    this.statusEl = el("div", "status-bar");
    top.appendChild(this.statusEl);
    screen.appendChild(top);

    const boardSlot = el("div", "game-board-slot");
    boardSlot.appendChild(this.board.el);
    screen.appendChild(boardSlot);

    const bottom = el("div", "game-bottom");
    this.controlsEl = el("div", "game-controls");
    bottom.appendChild(this.controlsEl);
    screen.appendChild(bottom);

    this.root.appendChild(screen);

    this.ctrl.start();
    this.update();
  }

  destroy(): void {
    this.ctrl.dispose();
    this.root.innerHTML = "";
  }

  private update(): void {
    this.titleEl.textContent = this.ctrl.role === "spectator" ? "Online (spectating)" : "Online";
    this.playersEl.textContent = this.playersText();

    const showShare = this.ctrl.status === "waiting" && this.ctrl.role !== "spectator";
    this.sharePanel.style.display = showShare ? "" : "none";
    if (showShare) this.shareInput.value = this.ctrl.shareUrl();

    this.statusEl.textContent = this.statusText();
    this.board.update();
    this.updateControls();
  }

  private updateControls(): void {
    this.controlsEl.replaceChildren();
    const status = this.ctrl.status;
    const role = this.ctrl.role;

    if (status === "finished" && role && role !== "spectator") {
      const offered = this.ctrl.state?.rematchOfferedBy ?? null;
      const my = this.ctrl.color;
      if (offered && offered !== my) {
        const accept = el("button", "primary", "Accept rematch");
        accept.onclick = () => this.ctrl.offerRematch();
        this.controlsEl.appendChild(accept);
      } else if (offered && offered === my) {
        this.controlsEl.appendChild(el("span", "rematch-pending", "Rematch requested…"));
      } else {
        const rematch = el("button", "primary", "Rematch");
        rematch.onclick = () => this.ctrl.offerRematch();
        this.controlsEl.appendChild(rematch);
      }
    }

    const leave = el("button", "", "Back to home");
    leave.onclick = () => this.onBack();
    this.controlsEl.appendChild(leave);
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
    const opp = s.players[s.color === "white" ? "black" : "white"];
    if (opp && !opp.connected) return "Opponent disconnected — waiting to reconnect…";
    if (this.ctrl.role === "spectator") {
      return `${s.moves.length % 2 === 0 ? "White" : "Black"} to move`;
    }
    return this.ctrl.yourTurn && !this.ctrl.awaitingMove ? "Your move" : "Opponent's move";
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

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  if (tag === "button") (node as HTMLButtonElement).type = "button";
  return node;
}
