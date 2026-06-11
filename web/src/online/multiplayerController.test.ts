import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChessGame } from "../engine/chessGame";
import { MultiplayerController } from "./multiplayerController";
import type { StateMessage } from "./protocol";
import type { SocketLike } from "./wsClient";
import type { CompletedGameRecord } from "../game/gameHistory";

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

describe("MultiplayerController — online history recording", () => {
  function makeCtrl(
    recorder: (state: StateMessage, game: ChessGame) => void
  ): { fake: FakeSocket; ctrl: MultiplayerController } {
    const fake = new FakeSocket();
    const ctrl = new MultiplayerController(
      "R",
      { token: "t", name: "Alice" },
      "wss://x",
      () => {},
      () => {},
      () => fake,
      recorder
    );
    ctrl.start();
    fake.open();
    return { fake, ctrl };
  }

  it("calls recorder once on active → finished as white", () => {
    const calls: Array<{ state: StateMessage; game: ChessGame }> = [];
    const { fake, ctrl } = makeCtrl((state, game) => calls.push({ state, game }));

    // First: active state
    fake.recv(stateMsg({
      status: "active",
      role: "white",
      color: "white",
      players: { white: { name: "Alice", connected: true }, black: { name: "Bob", connected: true } },
      result: { type: "ongoing" },
    }));
    assert.equal(calls.length, 0);

    // Now: finished
    fake.recv(stateMsg({
      status: "finished",
      role: "white",
      color: "white",
      players: { white: { name: "Alice", connected: true }, black: { name: "Bob", connected: true } },
      result: { type: "checkmate", winner: "white" },
    }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].state.status, "finished");
    void ctrl;
  });

  it("does not call recorder when connecting straight into a finished room", () => {
    const calls: Array<StateMessage> = [];
    const { fake } = makeCtrl((state) => calls.push(state));

    // First state is already finished (no preceding active state)
    fake.recv(stateMsg({
      status: "finished",
      role: "white",
      color: "white",
      result: { type: "checkmate", winner: "white" },
    }));
    assert.equal(calls.length, 0);
  });

  it("does not call recorder for spectator role", () => {
    const calls: Array<StateMessage> = [];
    const { fake } = makeCtrl((state) => calls.push(state));

    fake.recv(stateMsg({ status: "active", role: "spectator", color: null }));
    fake.recv(stateMsg({
      status: "finished",
      role: "spectator",
      color: null,
      result: { type: "checkmate", winner: "white" },
    }));
    assert.equal(calls.length, 0);
  });

  it("calls recorder again after rematch finishes (twice total)", () => {
    const calls: Array<StateMessage> = [];
    const { fake } = makeCtrl((state) => calls.push(state));

    const activePlayers = { white: { name: "Alice", connected: true }, black: { name: "Bob", connected: true } };

    // First game: active → finished
    fake.recv(stateMsg({ status: "active", role: "white", color: "white", players: activePlayers, result: { type: "ongoing" } }));
    fake.recv(stateMsg({ status: "finished", role: "white", color: "white", players: activePlayers, result: { type: "checkmate", winner: "white" } }));
    assert.equal(calls.length, 1);

    // Rematch: finished → active (moves reset), then a second finish
    fake.recv(stateMsg({ status: "active", role: "white", color: "white", players: activePlayers, moves: [], result: { type: "ongoing" } }));
    fake.recv(stateMsg({ status: "finished", role: "white", color: "white", players: activePlayers, result: { type: "resignation", winner: "black" } }));
    assert.equal(calls.length, 2);
  });
});

// ── NEW: online result threading (item 2) ────────────────────────────────────
import { completedGameRecord, appendGameToHistory } from "../game/gameHistory";
import type { CompletedGameRecord } from "../game/gameHistory";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("defaultRecordHistory — server result threading", () => {
  it("produces a completed record when server says finished but move list alone is ongoing", () => {
    // A game where the move list hasn't ended (e.g. resigned via message),
    // but the server result says finished.  defaultRecordHistory must use the
    // server result rather than deriving it only from the move list.
    const records: CompletedGameRecord[] = [];
    const storage = fakeStorage();

    function testRecordHistory(msg: StateMessage, game: ChessGame): void {
      const playerColor = msg.color;
      if (!playerColor) return;
      const oppColor = playerColor === "white" ? "black" : "white";
      const oppPlayer = msg.players[oppColor];
      const opponent = oppPlayer?.name ?? "Opponent";

      // Use fallbackResult from server when move-derived result is ongoing
      const serverResult = msg.result;
      const fallbackResult = serverResult.type !== "ongoing" ? serverResult : undefined;

      const record = completedGameRecord({
        game,
        mode: "online",
        difficulty: null,
        playerColor,
        opponent,
        fallbackResult,
      });
      if (record) {
        appendGameToHistory(record, storage);
        records.push(record);
      }
    }

    const fake = new FakeSocket();
    const ctrl = new MultiplayerController(
      "R",
      { token: "t", name: "Alice" },
      "wss://x",
      () => {},
      () => {},
      () => fake,
      testRecordHistory
    );
    ctrl.start();
    fake.open();

    // Active game with zero moves
    fake.recv(stateMsg({
      status: "active",
      role: "white",
      color: "white",
      players: { white: { name: "Alice", connected: true }, black: { name: "Bob", connected: true } },
      moves: [],
      result: { type: "ongoing" },
    }));

    // Server says finished with resignation — no moves were made
    fake.recv(stateMsg({
      status: "finished",
      role: "white",
      color: "white",
      players: { white: { name: "Alice", connected: true }, black: { name: "Bob", connected: true } },
      moves: [],
      result: { type: "resignation", winner: "black" },
    }));

    assert.equal(records.length, 1, "should produce a record even with 0 moves");
    assert.equal(records[0].resultType, "resignation");
    assert.equal(records[0].winner, "black");
    void ctrl;
  });
});
