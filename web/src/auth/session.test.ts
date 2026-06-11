import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clearSession, getCachedProfile, getSessionToken, saveSession } from "./session";
import type { Profile } from "./api";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const sampleProfile: Profile = {
  userId: "user-123",
  email: "test@example.com",
  displayName: "Test User",
  avatarUrl: null,
  createdAt: "2024-01-01T00:00:00.000Z",
};

describe("session store", () => {
  it("returns null token and null profile for empty storage", () => {
    const storage = fakeStorage();
    assert.equal(getSessionToken(storage), null);
    assert.equal(getCachedProfile(storage), null);
  });

  it("round-trips token and profile via saveSession", () => {
    const storage = fakeStorage();
    saveSession("tok_abc", sampleProfile, storage);
    assert.equal(getSessionToken(storage), "tok_abc");
    const profile = getCachedProfile(storage);
    assert.ok(profile !== null);
    assert.equal(profile.userId, "user-123");
    assert.equal(profile.email, "test@example.com");
    assert.equal(profile.displayName, "Test User");
    assert.equal(profile.avatarUrl, null);
  });

  it("clearSession removes both token and profile", () => {
    const storage = fakeStorage();
    saveSession("tok_abc", sampleProfile, storage);
    clearSession(storage);
    assert.equal(getSessionToken(storage), null);
    assert.equal(getCachedProfile(storage), null);
  });

  it("corrupt profile JSON yields null profile but token is still readable", () => {
    const storage = fakeStorage({
      bc_session_token: "tok_good",
      bc_session_profile: "not-valid-json{{{",
    });
    assert.equal(getSessionToken(storage), "tok_good");
    assert.equal(getCachedProfile(storage), null);
  });

  it("overwriting session replaces both values", () => {
    const storage = fakeStorage();
    saveSession("tok_old", sampleProfile, storage);
    const newProfile: Profile = { ...sampleProfile, displayName: "Updated" };
    saveSession("tok_new", newProfile, storage);
    assert.equal(getSessionToken(storage), "tok_new");
    const profile = getCachedProfile(storage);
    assert.ok(profile !== null);
    assert.equal(profile.displayName, "Updated");
  });
});
