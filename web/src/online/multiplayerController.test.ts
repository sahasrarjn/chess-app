import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChessGame } from "../engine/chessGame";
import { MultiplayerController } from "./multiplayerController";
import type { StateMessage } from "./protocol";
import type { SocketLike } from "./wsClient";

class FakeSocket implements SocketLike {
  sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  recv(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  parsed(): Array<{ type: string; [k: string]: unknown }> {
    return this.sent.map((s) => JSON.parse(s));
  }
}

function stateMsg(over: Partial<StateMessage>): StateMessage {
  return {
    type: "state",
    roomId: "R",
    role: "white",
    color: "white",
    players: { white: { name: "Alice", connected: true }, black: null },
    moves: [],
    status: "waiting",
    result: { type: "ongoing" },
    yourTurn: false,
    rematchOfferedBy: null,
    ...over,
  };
}

describe("MultiplayerController", () => {
  it("sends join on open and tracks state", () => {
    const fake = new FakeSocket();
    const ctrl = new MultiplayerController("R", { token: "t", name: "Alice" }, "wss://x", () => {}, () => {}, () => fake);
    ctrl.start();
    fake.open();

    const join = fake.parsed()[0];
    assert.equal(join.type, "join");
    assert.equal(join.roomId, "R");
    assert.equal(join.token, "t");

    fake.recv(stateMsg({ status: "waiting" }));
    assert.equal(ctrl.color, "white");
    assert.equal(ctrl.canMove, false);
  });

  it("allows a move only when it's your active turn and sends it as UCI", () => {
    const fake = new FakeSocket();
    const ctrl = new MultiplayerController("R", { token: "t", name: "Alice" }, "wss://x", () => {}, () => {}, () => fake);
    ctrl.start();
    fake.open();
    fake.recv(
      stateMsg({
        status: "active",
        yourTurn: true,
        players: { white: { name: "Alice", connected: true }, black: { name: "Bob", connected: true } },
      })
    );
    assert.equal(ctrl.canMove, true);

    const sample = new ChessGame().legalMoves()[0];
    ctrl.handleSquareTap(sample.from);
    assert.equal(ctrl.isSelected(sample.from), true);
    ctrl.handleSquareTap(sample.to);

    const moves = fake.parsed().filter((m) => m.type === "move");
    assert.equal(moves.length, 1);
    assert.equal(typeof moves[0].uci, "string");
  });

  it("does not send a move when it is not your turn", () => {
    const fake = new FakeSocket();
    const ctrl = new MultiplayerController("R", { token: "t", name: "Bob" }, "wss://x", () => {}, () => {}, () => fake);
    ctrl.start();
    fake.open();
    fake.recv(stateMsg({ role: "black", color: "black", status: "active", yourTurn: false }));

    const sample = new ChessGame().legalMoves()[0];
    ctrl.handleSquareTap(sample.from);
    ctrl.handleSquareTap(sample.to);
    assert.equal(fake.parsed().filter((m) => m.type === "move").length, 0);
  });

  it("sends a rematch request", () => {
    const fake = new FakeSocket();
    const ctrl = new MultiplayerController("R", { token: "t", name: "Alice" }, "wss://x", () => {}, () => {}, () => fake);
    ctrl.start();
    fake.open();
    ctrl.offerRematch();
    assert.ok(fake.parsed().some((m) => m.type === "rematch"));
  });
});
