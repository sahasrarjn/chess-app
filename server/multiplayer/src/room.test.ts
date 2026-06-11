import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { moveUci } from "../../../web/src/engine/types";
import type { StateMessage } from "./protocol";
import {
  disconnect,
  emptyRoom,
  gameFromMoves,
  join,
  move,
  rematch,
  type RoomState,
} from "./room";

/** A legal UCI for whoever is to move in the given history. */
function aLegalUci(moves: string[]): string {
  const game = gameFromMoves(moves);
  return moveUci(game.legalMoves()[0]);
}

function activeRoom(now = 1000): RoomState {
  let r = emptyRoom("R1", now);
  r = join(r, "cW", "tokW", "Alice", now).state;
  r = join(r, "cB", "tokB", "Bob", now).state;
  return r;
}

function stateFor(out: { connId: string; message: unknown }[], connId: string): StateMessage {
  const msg = out.find((o) => o.connId === connId)?.message as StateMessage;
  assert.equal(msg.type, "state", `expected state message for ${connId}`);
  return msg;
}

describe("room: seat assignment", () => {
  it("seats the first joiner as White and stays waiting", () => {
    const res = join(emptyRoom("R", 1), "cW", "tokW", "Alice", 1);
    assert.equal(res.state.white?.name, "Alice");
    assert.equal(res.state.black, null);
    assert.equal(res.state.status, "waiting");
    assert.equal(res.out.length, 1);
    assert.equal(stateFor(res.out, "cW").role, "white");
  });

  it("seats the second (different token) as Black and starts the game", () => {
    const r = activeRoom();
    assert.equal(r.black?.name, "Bob");
    assert.equal(r.status, "active");
  });

  it("seats a third joiner as a spectator", () => {
    let r = activeRoom();
    r = join(r, "cS", "tokS", "Sam", 1500).state;
    assert.equal(r.spectators.length, 1);
    const after = join(r, "cS", "tokS", "Sam", 1500);
    assert.equal(stateFor(after.out, "cS").role, "spectator");
  });

  it("reconnects a seat by token with a new connection id", () => {
    const res = join(activeRoom(), "cW2", "tokW", "Alice", 3000);
    assert.equal(res.state.white?.connId, "cW2");
    assert.equal(res.state.white?.connected, true);
    assert.equal(stateFor(res.out, "cW2").role, "white");
  });
});

describe("room: moves", () => {
  it("applies a legal move and flips the turn for both clients", () => {
    const res = move(activeRoom(), "cW", aLegalUci([]), 2000);
    assert.equal(res.state.moves.length, 1);
    assert.equal(res.out.length, 2);
    assert.equal(stateFor(res.out, "cB").yourTurn, true);
    assert.equal(stateFor(res.out, "cW").yourTurn, false);
  });

  it("rejects an out-of-turn move", () => {
    const res = move(activeRoom(), "cB", aLegalUci([]), 2000);
    assert.equal(res.out[0].message.type, "error");
    assert.equal(res.state.moves.length, 0);
  });

  it("rejects a spectator move", () => {
    let r = activeRoom();
    r = join(r, "cS", "tokS", "Sam", 1500).state;
    const res = move(r, "cS", aLegalUci([]), 2000);
    assert.equal(res.out[0].message.type, "error");
  });

  it("rejects moves before the game is active", () => {
    const r = join(emptyRoom("R", 1), "cW", "tokW", "Alice", 1).state;
    const res = move(r, "cW", aLegalUci([]), 2);
    assert.equal(res.out[0].message.type, "error");
  });

  it("rejects an illegal move", () => {
    const res = move(activeRoom(), "cW", "a1a1", 2000);
    assert.equal(res.out[0].message.type, "error");
    assert.equal(res.state.moves.length, 0);
  });
});

describe("room: rematch", () => {
  it("records an offer then resets with swapped colors on accept", () => {
    const finished: RoomState = {
      ...activeRoom(),
      status: "finished",
      result: { type: "checkmate", winner: "white" },
    };
    const offer = rematch(finished, "cW", 4000);
    assert.equal(offer.state.rematchOfferedBy, "white");
    assert.equal(offer.state.status, "finished");

    const accept = rematch(offer.state, "cB", 5000);
    assert.equal(accept.state.status, "active");
    assert.equal(accept.state.moves.length, 0);
    assert.equal(accept.state.white?.name, "Bob");
    assert.equal(accept.state.black?.name, "Alice");
    assert.equal(accept.state.rematchOfferedBy, null);
  });

  it("rejects rematch while the game is ongoing", () => {
    const res = rematch(activeRoom(), "cW", 4000);
    assert.equal(res.out[0].message.type, "error");
  });
});

describe("room: disconnect", () => {
  it("marks a player disconnected but keeps the seat and notifies the opponent", () => {
    const res = disconnect(activeRoom(), "cW", 6000);
    assert.equal(res.state.white?.connected, false);
    assert.equal(res.state.white?.connId, null);
    assert.equal(res.out.length, 1);
    assert.equal(res.out[0].connId, "cB");
  });
});

describe("room: seat userId attribution", () => {
  it("join with userId sets it on the white seat", () => {
    const r = emptyRoom("R", 1);
    const res = join(r, "cW", "tokW", "Alice", 1, "u1");
    assert.equal(res.state.white?.userId, "u1");
  });

  it("second player without a session seats black with no userId", () => {
    const r = emptyRoom("R", 1);
    const s1 = join(r, "cW", "tokW", "Alice", 1, "u1").state;
    const res = join(s1, "cB", "tokB", "Bob", 1, null);
    assert.equal(res.state.black?.userId, undefined);
  });

  it("reconnect with a userId sets it; reconnect with null userId preserves a previously set one", () => {
    // First set userId
    const r = emptyRoom("R", 1);
    const s1 = join(r, "cW", "tokW", "Alice", 1, "u1").state;
    // Reconnect without userId (null) — should preserve "u1"
    const res = join(s1, "cW2", "tokW", "Alice", 2, null);
    assert.equal(res.state.white?.userId, "u1");
    // Reconnect with a userId — should set it
    const res2 = join(res.state, "cW3", "tokW", "Alice", 3, "u2");
    assert.equal(res2.state.white?.userId, "u2");
  });

  it("spectator join with a userId does not crash and stores nothing on seats", () => {
    let r = activeRoom();
    const res = join(r, "cS", "tokS", "Sam", 1500, "uSpec");
    assert.equal(res.state.spectators.length, 1);
    assert.equal(res.state.white?.userId, undefined);
    assert.equal(res.state.black?.userId, undefined);
  });
});
