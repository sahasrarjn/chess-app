import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bindTap, createTapActivation } from "./tapActivation";

type Listener = (event: any) => void;

class FakeTarget {
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  dispatch(type: string, event: any): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("createTapActivation", () => {
  it("activates touch pointer taps immediately and suppresses the follow-up synthetic click", () => {
    let moves = 0;
    const activation = createTapActivation(() => {
      moves++;
    });

    activation.handlePointerUp({ pointerType: "touch", button: 0, nowMs: 1000 });
    activation.handleClick(1100);

    assert.equal(moves, 1);
  });

  it("keeps mouse clicks active because pointerup is ignored for mouse input", () => {
    let moves = 0;
    const activation = createTapActivation(() => {
      moves++;
    });

    activation.handlePointerUp({ pointerType: "mouse", button: 0, nowMs: 1000 });
    activation.handleClick(1100);

    assert.equal(moves, 1);
  });
});

describe("bindTap", () => {
  it("runs a board tap on touchstart and suppresses the browser ghost click", () => {
    const target = new FakeTarget();
    let moves = 0;
    let prevented = 0;
    let stopped = 0;
    bindTap(target as unknown as HTMLElement, () => {
      moves++;
    });

    target.dispatch("touchstart", {
      touches: [{ clientX: 10, clientY: 10 }],
      preventDefault: () => {
        prevented++;
      },
    });
    target.dispatch("click", {
      detail: 1,
      preventDefault: () => {
        prevented++;
      },
      stopPropagation: () => {
        stopped++;
      },
    });

    assert.equal(moves, 1);
    assert.equal(prevented, 2);
    assert.equal(stopped, 1);
  });
});
