import type { GameResult, PieceColor } from "../engine/types";

export type Role = "white" | "black" | "spectator";

export interface PlayerView {
  name: string;
  connected: boolean;
}

export interface StateMessage {
  type: "state";
  roomId: string;
  role: Role;
  color: PieceColor | null;
  players: { white: PlayerView | null; black: PlayerView | null };
  moves: string[];
  status: "waiting" | "active" | "finished";
  result: GameResult;
  yourTurn: boolean;
  rematchOfferedBy: PieceColor | null;
}

export type ServerMessage = StateMessage | { type: "error"; message: string };

export type ClientMessage =
  | { type: "join"; roomId: string; token: string; name: string }
  | { type: "move"; uci: string }
  | { type: "rematch" };
