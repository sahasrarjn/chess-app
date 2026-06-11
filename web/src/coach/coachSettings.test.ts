import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COACH_ENABLED_KEY, loadCoachEnabled, saveCoachEnabled } from "./coachSettings";

/** Minimal in-memory storage mock */
function makeStorage(): { store: Map<string, string> } & Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };
}

describe("coachSettings", () => {
  it("default off: empty storage returns false", () => {
    const storage = makeStorage();
    assert.equal(loadCoachEnabled(storage), false);
  });

  it("save(true) then load returns true", () => {
    const storage = makeStorage();
    saveCoachEnabled(true, storage);
    assert.equal(storage.store.get(COACH_ENABLED_KEY), "1");
    assert.equal(loadCoachEnabled(storage), true);
  });

  it("save(false) removes the key and load returns false", () => {
    const storage = makeStorage();
    saveCoachEnabled(true, storage);
    saveCoachEnabled(false, storage);
    assert.equal(storage.store.has(COACH_ENABLED_KEY), false);
    assert.equal(loadCoachEnabled(storage), false);
  });

  it("garbage value → false", () => {
    const storage = makeStorage();
    storage.setItem(COACH_ENABLED_KEY, "true"); // not "1"
    assert.equal(loadCoachEnabled(storage), false);
  });

  it("throwing storage returns false on load", () => {
    const badStorage = {
      getItem: (): string | null => { throw new Error("no storage"); },
      setItem: (): void => { throw new Error("no storage"); },
      removeItem: (): void => { throw new Error("no storage"); },
    };
    assert.equal(loadCoachEnabled(badStorage), false);
    // saveCoachEnabled should not throw
    assert.doesNotThrow(() => saveCoachEnabled(true, badStorage));
  });
});
