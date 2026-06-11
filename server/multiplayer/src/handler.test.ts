import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { moveUci } from "../../../web/src/engine/types";
import { handleEvent, type Broadcaster, type WsEvent, type HandlerOptions } from "./handler";
import type { ServerMessage } from "./protocol";
import type { StateMessage } from "./protocol";
import { emptyRoom, gameFromMoves, join as roomJoin, type RoomState, type Seat } from "./room";
import { InMemoryRoomStore } from "./store";
import type { OnlineGameRecord, UserGamesWriter } from "./record";

class CapturingBroadcaster implements Broadcaster {
  sent: { connId: string; message: ServerMessage }[] = [];
  async send(connId: string, message: ServerMessage): Promise<void> {
    this.sent.push({ connId, message });
  }
  to(connId: string): ServerMessage[] {
    return this.sent.filter((s) => s.connId === connId).map((s) => s.message);
  }
  clear(): void {
    this.sent = [];
  }
}

function ev(routeKey: string, connectionId: string, body?: unknown, queryStringParameters?: Record<string, string>): WsEvent {
  return {
    requestContext: { routeKey, connectionId, domainName: "d", stage: "prod" },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(queryStringParameters ? { queryStringParameters } : {}),
  };
}

/** Fake writer that captures all calls. */
class FakeWriter implements UserGamesWriter {
  games: { userId: string; game: OnlineGameRecord }[] = [];
  stats: { userId: string; key: string }[] = [];
  shouldThrow = false;
  async putGame(userId: string, game: OnlineGameRecord): Promise<void> {
    if (this.shouldThrow) throw new Error("simulated failure");
    this.games.push({ userId, game });
  }
  async addStat(userId: string, key: string): Promise<void> {
    if (this.shouldThrow) throw new Error("simulated failure");
    this.stats.push({ userId, key });
  }
}

/** Seed a finished room (both players signed in) directly into the store. */
function seatWithUser(name: string, token: string, connId: string, userId: string): Seat {
  return { token, name, connId, connected: true, userId };
}

function finishedRoomState(): RoomState {
  return {
    roomId: "FR",
    moves: ["e2e4", "e7e5"],
    status: "finished",
    white: seatWithUser("Alice", "tW", "cW", "u-alice"),
    black: seatWithUser("Bob", "tB", "cB", "u-bob"),
    spectators: [],
    rematchOfferedBy: null,
    result: { type: "checkmate", winner: "white" },
    createdAt: 1000,
    updatedAt: 2000,
    ttl: 999999,
  };
}

const NOW = 1_000;

describe("handler", () => {
  it("joins a room, stores the connection, and sends state", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    await handleEvent(ev("$default", "cW", { type: "join", roomId: "R", token: "tW", name: "Alice" }), store, bc, NOW);

    const state = bc.to("cW")[0];
    assert.equal(state.type, "state");
    assert.equal((state as { role: string }).role, "white");
    assert.ok(await store.getConnection("cW"));
    assert.ok(await store.getRoom("R"));
  });

  it("runs a full two-player move round", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    await handleEvent(ev("$default", "cW", { type: "join", roomId: "R", token: "tW", name: "Alice" }), store, bc, NOW);
    await handleEvent(ev("$default", "cB", { type: "join", roomId: "R", token: "tB", name: "Bob" }), store, bc, NOW);
    bc.clear();

    const uci = moveUci(gameFromMoves([]).legalMoves()[0]);
    await handleEvent(ev("$default", "cW", { type: "move", uci }), store, bc, NOW);

    const room = await store.getRoom("R");
    assert.equal(room?.moves.length, 1);
    assert.equal(bc.to("cB").length, 1, "black is notified of the move");
    assert.equal(bc.to("cW").length, 1, "white is notified of the move");
  });

  it("rejects a move from a connection that hasn't joined", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    await handleEvent(ev("$default", "ghost", { type: "move", uci: "e2e4" }), store, bc, NOW);
    assert.equal(bc.to("ghost")[0]?.type, "error");
  });

  it("on disconnect, removes the connection and notifies the opponent", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    await handleEvent(ev("$default", "cW", { type: "join", roomId: "R", token: "tW", name: "Alice" }), store, bc, NOW);
    await handleEvent(ev("$default", "cB", { type: "join", roomId: "R", token: "tB", name: "Bob" }), store, bc, NOW);
    bc.clear();

    await handleEvent(ev("$disconnect", "cW"), store, bc, NOW);
    assert.equal(await store.getConnection("cW"), null);
    const room = await store.getRoom("R");
    assert.equal(room?.white?.connected, false);
    assert.equal(bc.to("cB").length, 1, "opponent gets updated state");
  });
});

/** 7 moves that leave the game "ongoing" with black to move;
 *  the 8th move (a6b8) completes a 2nd round-trip and triggers threefold
 *  repetition, finishing the game. */
const NEAR_DRAW_MOVES = ["b1a3", "b8a6", "a3b1", "a6b8", "b1a3", "b8a6", "a3b1"];
const FINISHING_UCI = "a6b8";

/** Seed an active room with userId-attributed seats into the store. */
async function seedActiveRoomWithUsers(store: InMemoryRoomStore): Promise<void> {
  const room: RoomState = {
    roomId: "FR",
    moves: [...NEAR_DRAW_MOVES],
    status: "active",
    white: seatWithUser("Alice", "tW", "cW", "u-alice"),
    black: seatWithUser("Bob", "tB", "cB", "u-bob"),
    spectators: [],
    rematchOfferedBy: null,
    result: { type: "ongoing" },
    createdAt: 1000,
    updatedAt: 2000,
    ttl: 999999,
  };
  await store.putRoom(room);
  await store.putConnection({ connectionId: "cW", roomId: "FR", role: "white" });
  await store.putConnection({ connectionId: "cB", roomId: "FR", role: "black" });
}

describe("handler: $connect session verification", () => {
  it("$connect with valid session stores the userId", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    const verifySession = async (_token: string) => "user-123";
    await handleEvent(ev("$connect", "c1", undefined, { session: "valid-token" }), store, bc, NOW, { verifySession });
    assert.equal(await store.getConnectionUser("c1"), "user-123");
  });

  it("$connect with invalid session proceeds as guest (no error, no CONNUSER record)", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    const verifySession = async (_token: string) => { throw new Error("invalid token"); };
    const result = await handleEvent(ev("$connect", "c1", undefined, { session: "bad-token" }), store, bc, NOW, { verifySession });
    assert.equal(result.statusCode, 200);
    assert.equal(await store.getConnectionUser("c1"), null);
    assert.equal(bc.sent.length, 0, "no error sent to client");
  });

  it("$connect with no verifySession configured proceeds as guest", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    const result = await handleEvent(ev("$connect", "c1", undefined, { session: "some-token" }), store, bc, NOW, {});
    assert.equal(result.statusCode, 200);
    assert.equal(await store.getConnectionUser("c1"), null);
  });

  it("$connect with no session param produces no CONNUSER record", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    const verifySession = async (_token: string) => "user-123";
    await handleEvent(ev("$connect", "c1"), store, bc, NOW, { verifySession });
    assert.equal(await store.getConnectionUser("c1"), null);
  });

  it("join after $connect with session propagates userId to the seat", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    const verifySession = async (_token: string) => "user-abc";
    await handleEvent(ev("$connect", "cW", undefined, { session: "t" }), store, bc, NOW, { verifySession });
    await handleEvent(ev("$default", "cW", { type: "join", roomId: "R2", token: "tW", name: "Alice" }), store, bc, NOW, { verifySession });
    const room = await store.getRoom("R2");
    assert.equal(room?.white?.userId, "user-abc");
  });
});

describe("handler: game recording", () => {
  it("finishing move triggers recording: fake writer receives the game and broadcast still goes out", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    const writer = new FakeWriter();
    await seedActiveRoomWithUsers(store);

    await handleEvent(ev("$default", "cB", { type: "move", uci: FINISHING_UCI }), store, bc, NOW, { games: writer });

    const room = await store.getRoom("FR");
    assert.equal(room?.status, "finished", "room should be finished");
    assert.equal(writer.games.length, 2, "both players should be recorded");
    assert.ok(bc.sent.length >= 1, "broadcast still went out");
  });

  it("rematch then another game finish records again (once per game)", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    const writer = new FakeWriter();

    // First, create a finished room
    await seedActiveRoomWithUsers(store);
    await handleEvent(ev("$default", "cB", { type: "move", uci: FINISHING_UCI }), store, bc, NOW, { games: writer });
    assert.equal(writer.games.length, 2, "first game recorded");

    // Rematch: both players offer and accept
    await handleEvent(ev("$default", "cW", { type: "rematch" }), store, bc, NOW, { games: writer });
    await handleEvent(ev("$default", "cB", { type: "rematch" }), store, bc, NOW, { games: writer });
    const afterRematch = await store.getRoom("FR");
    assert.equal(afterRematch?.status, "active", "room should be active after rematch");
    assert.equal(writer.games.length, 2, "no extra records during rematch");

    // Now we need to finish the rematch game too. But the rematch swaps colors.
    // After rematch, cB (Bob) is white and cW (Alice) is black.
    // We need to feed NEAR_DRAW_MOVES back in via move events.
    // Simpler: directly seed the room state again and apply the finishing move.
    const rematchRoom = await store.getRoom("FR");
    assert.ok(rematchRoom);
    // Replace moves with NEAR_DRAW_MOVES to get back to near-draw state
    const seededRematch: RoomState = {
      ...rematchRoom!,
      moves: [...NEAR_DRAW_MOVES],
      result: { type: "ongoing" },
      status: "active",
    };
    await store.putRoom(seededRematch);
    // cB is now white (after swap), cW is now black. NEAR_DRAW_MOVES has 7 moves (white started),
    // so it's black's turn. cW (now playing black) sends the finishing move.
    await handleEvent(ev("$default", "cW", { type: "move", uci: FINISHING_UCI }), store, bc, NOW, { games: writer });
    assert.equal(writer.games.length, 4, "second game also recorded (2 players each = 4 total)");
  });

  it("move on already-finished room: error returned, writer not called", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    const writer = new FakeWriter();

    // Seed a pre-finished room
    const finishedRoom: RoomState = {
      roomId: "FIN",
      moves: ["e2e4"],
      status: "finished",
      white: seatWithUser("Alice", "tW", "cW2", "u-alice"),
      black: seatWithUser("Bob", "tB", "cB2", "u-bob"),
      spectators: [],
      rematchOfferedBy: null,
      result: { type: "checkmate", winner: "white" },
      createdAt: 1000,
      updatedAt: 2000,
      ttl: 999999,
    };
    await store.putRoom(finishedRoom);
    await store.putConnection({ connectionId: "cW2", roomId: "FIN", role: "white" });
    await store.putConnection({ connectionId: "cB2", roomId: "FIN", role: "black" });

    bc.clear();
    await handleEvent(ev("$default", "cB2", { type: "move", uci: "e7e5" }), store, bc, NOW, { games: writer });

    assert.equal(bc.to("cB2")[0]?.type, "error", "should return error for move on finished room");
    assert.equal(writer.games.length, 0, "writer not called for already-finished room");
  });

  it("writer throws: move still broadcasts, handler returns 200", async () => {
    const store = new InMemoryRoomStore();
    const bc = new CapturingBroadcaster();
    const writer = new FakeWriter();
    writer.shouldThrow = true;

    await seedActiveRoomWithUsers(store);
    const result = await handleEvent(ev("$default", "cB", { type: "move", uci: FINISHING_UCI }), store, bc, NOW, { games: writer });

    assert.equal(result.statusCode, 200, "handler still returns 200 despite writer failure");
    assert.ok(bc.sent.length >= 1, "broadcast still went out despite writer failure");
  });
});

describe("store: putConnectionUser / getConnectionUser", () => {
  it("round-trips a userId for a connection", async () => {
    const store = new InMemoryRoomStore();
    await store.putConnectionUser("conn1", "user-xyz");
    assert.equal(await store.getConnectionUser("conn1"), "user-xyz");
  });

  it("returns null for an unknown connection", async () => {
    const store = new InMemoryRoomStore();
    assert.equal(await store.getConnectionUser("missing"), null);
  });

  it("deleteConnection also clears the CONNUSER entry", async () => {
    const store = new InMemoryRoomStore();
    await store.putConnectionUser("conn1", "user-xyz");
    await store.deleteConnection("conn1");
    assert.equal(await store.getConnectionUser("conn1"), null);
  });
});
