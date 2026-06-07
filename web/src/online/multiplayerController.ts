import { ChessGame, squaresEqual } from "../engine/chessGame";
import { matchEngineMove } from "../engine/fen";
import { moveUci, type Move, type PieceColor, type Piece, type Square } from "../engine/types";
import { classifyMoveSound, type SoundEvent } from "../audio/classifyMoveSound";
import type { StateMessage } from "./protocol";
import { WsClient, type SocketFactory, type WsStatus } from "./wsClient";

export interface Identity {
  token: string;
  name: string;
}

export class MultiplayerController {
  state: StateMessage | null = null;
  connection: WsStatus = "connecting";
  lastError: string | null = null;
  selectedSquare: Square | null = null;
  legalTargets = new Set<string>();
  captureTargets = new Set<string>();

  private game = new ChessGame();
  private lastMove: Move | null = null;
  private firstState = true;
  private readonly ws: WsClient;

  constructor(
    readonly roomId: string,
    identity: Identity,
    wsUrl: string,
    private readonly onChange: () => void,
    private readonly onSound: (event: SoundEvent) => void,
    factory?: SocketFactory
  ) {
    this.ws = new WsClient({
      url: wsUrl,
      factory,
      onStatus: (s) => {
        this.connection = s;
        this.onChange();
      },
      onOpen: () =>
        this.ws.send({ type: "join", roomId, token: identity.token, name: identity.name }),
      onMessage: (m) => {
        if (m.type === "error") {
          this.lastError = m.message;
          this.onChange();
          return;
        }
        this.applyState(m);
      },
    });
  }

  start(): void {
    this.ws.connect();
  }

  dispose(): void {
    this.ws.close();
  }

  get color(): PieceColor | null {
    return this.state?.color ?? null;
  }
  get role(): StateMessage["role"] | null {
    return this.state?.role ?? null;
  }
  get status(): StateMessage["status"] | null {
    return this.state?.status ?? null;
  }
  get boardFlipped(): boolean {
    return this.color === "black";
  }
  get yourTurn(): boolean {
    return !!this.state?.yourTurn;
  }
  get canMove(): boolean {
    return this.state?.status === "active" && this.yourTurn && this.color !== null;
  }

  squareKey(s: Square): string {
    return `${s.row},${s.col}`;
  }
  piece(at: Square): Piece | null {
    return this.game.piece(at);
  }
  isSelected(s: Square): boolean {
    return this.selectedSquare != null && squaresEqual(this.selectedSquare, s);
  }
  isLegalTarget(s: Square): boolean {
    return this.legalTargets.has(this.squareKey(s));
  }
  isCaptureTarget(s: Square): boolean {
    return this.captureTargets.has(this.squareKey(s));
  }
  isLastMoveSquare(s: Square): boolean {
    return (
      this.lastMove != null &&
      (squaresEqual(this.lastMove.from, s) || squaresEqual(this.lastMove.to, s))
    );
  }
  isKingInCheck(s: Square): boolean {
    const p = this.game.piece(s);
    if (p?.kind !== "K") return false;
    return this.game.isInCheck(p.color) && this.game.activeColor === p.color;
  }

  handleSquareTap(square: Square): void {
    if (!this.canMove) return;
    const myColor = this.color;
    if (!myColor) return;

    if (this.selectedSquare) {
      if (squaresEqual(this.selectedSquare, square)) {
        this.clearSelection();
        this.onChange();
        return;
      }
      if (this.legalTargets.has(this.squareKey(square))) {
        const from = this.selectedSquare;
        const candidates = this.game
          .legalMoves()
          .filter((m) => squaresEqual(m.from, from) && squaresEqual(m.to, square));
        const move = candidates.find((m) => m.promotion === "Q") ?? candidates[0];
        if (move) {
          this.ws.send({ type: "move", uci: moveUci(move) });
          this.clearSelection();
          this.onChange();
          return;
        }
      }
      const p = this.game.piece(square);
      if (p?.color === myColor) this.select(square);
      else this.clearSelection();
      this.onChange();
      return;
    }

    const p = this.game.piece(square);
    if (p?.color === myColor) {
      this.select(square);
      this.onChange();
    }
  }

  offerRematch(): void {
    this.ws.send({ type: "rematch" });
  }

  shareUrl(): string {
    const base = `${location.origin}${location.pathname}`;
    return `${base}?room=${encodeURIComponent(this.roomId)}`;
  }

  private select(square: Square): void {
    this.selectedSquare = square;
    const moves = this.game.legalMoves().filter((m) => squaresEqual(m.from, square));
    this.legalTargets = new Set(moves.map((m) => this.squareKey(m.to)));
    this.captureTargets = new Set(
      moves.filter((m) => this.game.piece(m.to) || m.isEnPassant).map((m) => this.squareKey(m.to))
    );
  }

  private clearSelection(): void {
    this.selectedSquare = null;
    this.legalTargets.clear();
    this.captureTargets.clear();
  }

  private applyState(msg: StateMessage): void {
    const prevCount = this.firstState ? msg.moves.length : (this.state?.moves.length ?? 0);
    this.lastError = null;
    this.state = msg;
    this.rebuild(prevCount);
    this.firstState = false;
    this.onChange();
  }

  private rebuild(prevCount: number): void {
    const moves = this.state?.moves ?? [];
    const game = new ChessGame();
    let lastMove: Move | null = null;
    let capturedOnLast = false;
    for (let i = 0; i < moves.length; i++) {
      const mv = matchEngineMove(game, moves[i]);
      if (!mv) break;
      if (i === moves.length - 1) {
        lastMove = mv;
        capturedOnLast = game.piece(mv.to) != null || !!mv.isEnPassant;
      }
      game.applyMove(mv);
    }
    this.game = game;
    this.lastMove = lastMove;
    this.clearSelection();

    if (moves.length > prevCount && lastMove) {
      const result = this.state!.result;
      const givesCheck = result.type === "ongoing" && game.isInCheck(game.activeColor);
      this.onSound(
        classifyMoveSound({ resultType: result.type, givesCheck, captured: capturedOnLast, move: lastMove })
      );
    } else if (moves.length === 0 && prevCount > 0) {
      this.onSound("game-start");
    }
  }
}
