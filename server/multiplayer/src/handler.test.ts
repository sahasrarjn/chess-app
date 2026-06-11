import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { moveUci } from "../../../web/src/engine/types";
import { handleEvent, type Broadcaster, type WsEvent } from "./handler";
import type { ServerMessage } from "./protocol";
import { gameFromMoves } from "./room";
import { InMemoryRoomStore } from "./store";
import type { StateMessage } from "./protocol";

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

function ev(routeKey: string, connectionId: string, body?: unknown): WsEvent {
  return {
    requestContext: { routeKey, connectionId, domainName: "d", stage: "prod" },
    body: body === undefined ? undefined : JSON.stringify(body),
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
