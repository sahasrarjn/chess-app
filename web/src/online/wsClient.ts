import type { ClientMessage, ServerMessage } from "./protocol";

export type WsStatus = "connecting" | "open" | "reconnecting" | "closed";

/** Minimal surface we use from a WebSocket — lets tests inject a fake. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface WsClientOptions {
  url: string;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: WsStatus) => void;
  /** Called on every (re)connection — use it to (re)send `join`. */
  onOpen?: () => void;
  factory?: SocketFactory;
  /** Override for tests; default backoff doubles from 500ms to 8s. */
  baseBackoffMs?: number;
}

const OPEN = 1;

export class WsClient {
  private socket: SocketLike | null = null;
  private closedByUser = false;
  private backoff: number;
  private readonly factory: SocketFactory;

  constructor(private readonly opts: WsClientOptions) {
    this.factory = opts.factory ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.backoff = opts.baseBackoffMs ?? 500;
  }

  connect(): void {
    this.closedByUser = false;
    this.open(true);
  }

  private open(first: boolean): void {
    this.opts.onStatus(first ? "connecting" : "reconnecting");
    const socket = this.factory(this.opts.url);
    this.socket = socket;

    socket.onopen = () => {
      this.backoff = this.opts.baseBackoffMs ?? 500;
      this.opts.onStatus("open");
      this.opts.onOpen?.();
    };
    socket.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.opts.onMessage(msg);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.closedByUser) {
        this.opts.onStatus("closed");
        return;
      }
      this.opts.onStatus("reconnecting");
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, 8000);
      setTimeout(() => {
        if (!this.closedByUser) this.open(false);
      }, delay);
    };
  }

  send(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.closedByUser = true;
    this.socket?.close();
  }
}
