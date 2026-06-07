import type { GameResult, PieceColor } from "../../../web/src/engine/types";

export type Role = "white" | "black" | "spectator";

/** Messages the browser sends to the room. */
export type ClientMessage =
  | { type: "join"; roomId: string; token: string; name: string }
  | { type: "move"; uci: string }
  | { type: "rematch" };

/** Public view of a seat (no token / connectionId ever leaves the server). */
export interface PlayerView {
  name: string;
  connected: boolean;
}

/** Authoritative game snapshot, personalized per recipient. */
export interface StateMessage {
  type: "state";
  roomId: string;
  role: Role;
  /** The piece color this client controls; null for spectators. */
  color: PieceColor | null;
  players: { white: PlayerView | null; black: PlayerView | null };
  moves: string[];
  status: "waiting" | "active" | "finished";
  result: GameResult;
  yourTurn: boolean;
  rematchOfferedBy: PieceColor | null;
}

export type ServerMessage =
  | StateMessage
  | { type: "error"; message: string };

export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case "join":
      if (
        typeof m.roomId === "string" &&
        typeof m.token === "string" &&
        typeof m.name === "string" &&
        m.roomId.length > 0 &&
        m.roomId.length <= 64 &&
        m.token.length > 0 &&
        m.token.length <= 128
      ) {
        return { type: "join", roomId: m.roomId, token: m.token, name: sanitizeName(m.name) };
      }
      return null;
    case "move":
      if (typeof m.uci === "string" && m.uci.length > 0 && m.uci.length <= 8) {
        return { type: "move", uci: m.uci };
      }
      return null;
    case "rematch":
      return { type: "rematch" };
    default:
      return null;
  }
}

/** Trim, collapse whitespace, cap length; fall back to a generic guest label. */
export function sanitizeName(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim().slice(0, 24);
  return cleaned.length > 0 ? cleaned : "Guest";
}
