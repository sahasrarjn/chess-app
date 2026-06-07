import { ChessGame } from "../../../web/src/engine/chessGame";
import { matchEngineMove } from "../../../web/src/engine/fen";
import type { GameResult, PieceColor } from "../../../web/src/engine/types";
import type { PlayerView, Role, ServerMessage, StateMessage } from "./protocol";

export interface Seat {
  token: string;
  name: string;
  connId: string | null;
  connected: boolean;
}

export interface RoomState {
  roomId: string;
  moves: string[];
  status: "waiting" | "active" | "finished";
  white: Seat | null;
  black: Seat | null;
  spectators: { connId: string }[];
  rematchOfferedBy: PieceColor | null;
  result: GameResult;
  createdAt: number;
  updatedAt: number;
  ttl: number;
}

export interface Outbound {
  connId: string;
  message: ServerMessage;
}

export interface ReduceResult {
  state: RoomState;
  out: Outbound[];
}

const TTL_SECONDS = 24 * 60 * 60;

export function emptyRoom(roomId: string, now: number): RoomState {
  return {
    roomId,
    moves: [],
    status: "waiting",
    white: null,
    black: null,
    spectators: [],
    rematchOfferedBy: null,
    result: { type: "ongoing" },
    createdAt: now,
    updatedAt: now,
    ttl: Math.floor(now / 1000) + TTL_SECONDS,
  };
}

function touch(state: RoomState, now: number): void {
  state.updatedAt = now;
  state.ttl = Math.floor(now / 1000) + TTL_SECONDS;
}

function cloneRoom(state: RoomState): RoomState {
  return {
    ...state,
    moves: [...state.moves],
    white: state.white ? { ...state.white } : null,
    black: state.black ? { ...state.black } : null,
    spectators: state.spectators.map((s) => ({ ...s })),
    result: { ...state.result } as GameResult,
  };
}

/** Replay the authoritative move list into a fresh game. Throws on corruption. */
export function gameFromMoves(moves: string[]): ChessGame {
  const game = new ChessGame();
  for (const uci of moves) {
    const move = matchEngineMove(game, uci);
    if (!move || !game.applyMove(move)) {
      throw new Error(`Corrupt move history at ${uci}`);
    }
  }
  return game;
}

export function roleOf(state: RoomState, connId: string): Role | null {
  if (state.white?.connId === connId) return "white";
  if (state.black?.connId === connId) return "black";
  if (state.spectators.some((s) => s.connId === connId)) return "spectator";
  return null;
}

function colorForRole(role: Role): PieceColor | null {
  if (role === "white") return "white";
  if (role === "black") return "black";
  return null;
}

export function connIds(state: RoomState): string[] {
  const ids = new Set<string>();
  if (state.white?.connId) ids.add(state.white.connId);
  if (state.black?.connId) ids.add(state.black.connId);
  for (const s of state.spectators) ids.add(s.connId);
  return [...ids];
}

function viewOf(seat: Seat | null): PlayerView | null {
  return seat ? { name: seat.name, connected: seat.connected } : null;
}

export function stateMessageFor(
  state: RoomState,
  connId: string,
  activeColor: PieceColor
): StateMessage {
  const role = roleOf(state, connId) ?? "spectator";
  const color = colorForRole(role);
  return {
    type: "state",
    roomId: state.roomId,
    role,
    color,
    players: { white: viewOf(state.white), black: viewOf(state.black) },
    moves: [...state.moves],
    status: state.status,
    result: state.result,
    yourTurn: state.status === "active" && color !== null && color === activeColor,
    rematchOfferedBy: state.rematchOfferedBy,
  };
}

function broadcast(state: RoomState): Outbound[] {
  const activeColor = gameFromMoves(state.moves).activeColor;
  return connIds(state).map((connId) => ({
    connId,
    message: stateMessageFor(state, connId, activeColor),
  }));
}

function errorTo(connId: string, message: string): Outbound[] {
  return [{ connId, message: { type: "error", message } }];
}

function recomputeStatus(state: RoomState): void {
  if (state.result.type !== "ongoing") {
    state.status = "finished";
  } else if (state.white && state.black) {
    state.status = "active";
  } else {
    state.status = "waiting";
  }
}

export function join(
  prev: RoomState,
  connId: string,
  token: string,
  name: string,
  now: number
): ReduceResult {
  const state = cloneRoom(prev);
  touch(state, now);

  if (state.white?.token === token) {
    state.white.connId = connId;
    state.white.connected = true;
    state.white.name = name;
  } else if (state.black?.token === token) {
    state.black.connId = connId;
    state.black.connected = true;
    state.black.name = name;
  } else if (!state.white) {
    state.white = { token, name, connId, connected: true };
  } else if (!state.black) {
    state.black = { token, name, connId, connected: true };
  } else {
    if (!state.spectators.some((s) => s.connId === connId)) {
      state.spectators.push({ connId });
    }
  }

  recomputeStatus(state);
  return { state, out: broadcast(state) };
}

export function move(
  prev: RoomState,
  connId: string,
  uci: string,
  now: number
): ReduceResult {
  const role = roleOf(prev, connId);
  const moverColor = role ? colorForRole(role) : null;
  if (!moverColor) return { state: prev, out: errorTo(connId, "Spectators can't move.") };
  if (prev.status !== "active") {
    return { state: prev, out: errorTo(connId, "The game is not active.") };
  }

  const game = gameFromMoves(prev.moves);
  if (game.activeColor !== moverColor) {
    return { state: prev, out: errorTo(connId, "It's not your turn.") };
  }

  const matched = matchEngineMove(game, uci);
  if (!matched || !game.applyMove(matched)) {
    return { state: prev, out: errorTo(connId, "Illegal move.") };
  }

  const state = cloneRoom(prev);
  touch(state, now);
  state.moves.push(uci);
  state.result = game.result;
  state.rematchOfferedBy = null;
  recomputeStatus(state);
  return { state, out: broadcast(state) };
}

export function rematch(prev: RoomState, connId: string, now: number): ReduceResult {
  const role = roleOf(prev, connId);
  const moverColor = role ? colorForRole(role) : null;
  if (!moverColor) return { state: prev, out: errorTo(connId, "Only players can rematch.") };
  if (prev.status !== "finished") {
    return { state: prev, out: errorTo(connId, "The game isn't over yet.") };
  }

  const state = cloneRoom(prev);
  touch(state, now);

  if (state.rematchOfferedBy === null || state.rematchOfferedBy === moverColor) {
    // First request, or the same player re-requesting: record the standing offer.
    state.rematchOfferedBy = moverColor;
    return { state, out: broadcast(state) };
  }

  // The opponent accepted — reset with swapped colors (loser/second player gets White next? simply swap seats).
  const oldWhite = state.white;
  const oldBlack = state.black;
  state.white = oldBlack;
  state.black = oldWhite;
  state.moves = [];
  state.result = { type: "ongoing" };
  state.rematchOfferedBy = null;
  recomputeStatus(state);
  return { state, out: broadcast(state) };
}

export function disconnect(prev: RoomState, connId: string, now: number): ReduceResult {
  const role = roleOf(prev, connId);
  if (!role) return { state: prev, out: [] };

  const state = cloneRoom(prev);
  touch(state, now);
  if (role === "white" && state.white) {
    state.white.connId = null;
    state.white.connected = false;
  } else if (role === "black" && state.black) {
    state.black.connId = null;
    state.black.connected = false;
  } else {
    state.spectators = state.spectators.filter((s) => s.connId !== connId);
  }
  return { state, out: broadcast(state) };
}
