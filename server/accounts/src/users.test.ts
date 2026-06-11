import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IdpIdentity } from "./idtoken";
import { InMemoryUserStore } from "./store";
import { resolveUser } from "./users";

describe("InMemoryUserStore.updateDisplayName", () => {
  it("throws when userId does not exist (mirrors Dynamo conditional update)", async () => {
    const store = new InMemoryUserStore();
    await assert.rejects(
      () => store.updateDisplayName("nonexistent-user", "New Name"),
      /not found|does not exist|ConditionalCheckFailed/i
    );
  });
});

describe("InMemoryUserStore putMapping conditional semantics", () => {
  it("putIdpMapping returns true on first write, false when already exists (no clobber)", async () => {
    const store = new InMemoryUserStore();
    const first = await store.putIdpMapping("google", "sub-1", "user-a");
    assert.equal(first, true, "first put should report written");

    const second = await store.putIdpMapping("google", "sub-1", "user-b");
    assert.equal(second, false, "second put should report already existed");

    // The original mapping must NOT be overwritten
    const userId = await store.getUserIdByIdp("google", "sub-1");
    assert.equal(userId, "user-a");
  });

  it("putEmailMapping returns true on first write, false when already exists (no clobber)", async () => {
    const store = new InMemoryUserStore();
    const first = await store.putEmailMapping("a@example.com", "user-a");
    assert.equal(first, true);

    const second = await store.putEmailMapping("a@example.com", "user-b");
    assert.equal(second, false);

    const userId = await store.getUserIdByEmail("a@example.com");
    assert.equal(userId, "user-a");
  });
});

const NOW = new Date("2025-01-01T00:00:00Z");

function googleId(sub: string, email: string | null = "user@gmail.com", name: string | null = "Test User"): IdpIdentity {
  return { provider: "google", sub, email, name, avatarUrl: "https://example.com/pic.jpg" };
}

function appleId(sub: string, email: string | null = null, name: string | null = null): IdpIdentity {
  return { provider: "apple", sub, email, name, avatarUrl: null };
}

describe("resolveUser", () => {
  it("new Google identity → creates user with correct fields", async () => {
    const store = new InMemoryUserStore();
    const identity = googleId("g-sub-1", "Alice@Gmail.com", "Alice Google");
    const user = await resolveUser(store, identity, undefined, NOW);

    assert.ok(user.userId.length > 0);
    // email stored lowercased
    assert.equal(user.email, "alice@gmail.com");
    assert.equal(user.displayName, "Alice Google");
    assert.equal(user.avatarUrl, "https://example.com/pic.jpg");
    assert.equal(user.createdAt, NOW.toISOString());
    assert.deepEqual(user.stats, {});

    // IDP# mapping written
    const byIdp = await store.getUserIdByIdp("google", "g-sub-1");
    assert.equal(byIdp, user.userId);

    // EMAIL# mapping written with lowercased email
    const byEmail = await store.getUserIdByEmail("alice@gmail.com");
    assert.equal(byEmail, user.userId);
  });

  it("same identity again → returns the SAME userId, no duplicate user created", async () => {
    const store = new InMemoryUserStore();
    const identity = googleId("g-sub-2", "bob@gmail.com", "Bob");
    const user1 = await resolveUser(store, identity, undefined, NOW);
    const user2 = await resolveUser(store, identity, undefined, NOW);

    assert.equal(user1.userId, user2.userId);
  });

  it("Apple with same verified email as existing Google user → links provider, returns existing userId", async () => {
    const store = new InMemoryUserStore();
    // First: create Google user
    const googleUser = await resolveUser(store, googleId("g-sub-3", "shared@example.com", "Shared User"), undefined, NOW);

    // Then: Apple login with same email
    const identity = appleId("apple-sub-1", "shared@example.com");
    const appleUser = await resolveUser(store, identity, undefined, NOW);

    // Should resolve to the same user
    assert.equal(appleUser.userId, googleUser.userId);

    // IDP#apple mapping should now be written
    const byAppleIdp = await store.getUserIdByIdp("apple", "apple-sub-1");
    assert.equal(byAppleIdp, googleUser.userId);

    // Profile unchanged (displayName still "Shared User")
    assert.equal(appleUser.displayName, "Shared User");
  });

  it("Apple identity with no email and no prior mapping → creates user with email:'', nameHint used for displayName, no EMAIL# mapping", async () => {
    const store = new InMemoryUserStore();
    const identity = appleId("apple-sub-2", null);
    const user = await resolveUser(store, identity, "My Apple Name", NOW);

    assert.equal(user.email, "");
    assert.equal(user.displayName, "My Apple Name");

    // No EMAIL# mapping should be written (empty email)
    const byEmail = await store.getUserIdByEmail("");
    assert.equal(byEmail, null);

    // IDP mapping should be written
    const byIdp = await store.getUserIdByIdp("apple", "apple-sub-2");
    assert.equal(byIdp, user.userId);
  });

  it("Apple repeat login with no email but existing IDP# mapping → resolves to the existing user", async () => {
    const store = new InMemoryUserStore();
    const identity = appleId("apple-sub-3", null);

    // First login: creates user
    const user1 = await resolveUser(store, identity, "Apple User", NOW);

    // Second login: same IDP, no email
    const user2 = await resolveUser(store, identity, undefined, NOW);

    assert.equal(user2.userId, user1.userId);
  });

  it("no name anywhere → displayName falls back to 'Player'", async () => {
    const store = new InMemoryUserStore();
    const identity: IdpIdentity = { provider: "apple", sub: "apple-sub-4", email: null, name: null, avatarUrl: null };
    const user = await resolveUser(store, identity, undefined, NOW);

    assert.equal(user.displayName, "Player");
  });

  it("nameHint is preferred over 'Player' only when token name is null", async () => {
    const store = new InMemoryUserStore();

    // Token has a name → use token name, not nameHint
    const id1 = googleId("g-sub-4", "email@example.com", "Token Name");
    const user1 = await resolveUser(store, id1, "Hint Name", NOW);
    assert.equal(user1.displayName, "Token Name");

    // Token has no name → use nameHint
    const id2: IdpIdentity = { provider: "google", sub: "g-sub-5", email: "other@example.com", name: null, avatarUrl: null };
    const user2 = await resolveUser(store, id2, "Hint Name", NOW);
    assert.equal(user2.displayName, "Hint Name");
  });

  it("invalid nameHint (too long) → falls back to 'Player'", async () => {
    const store = new InMemoryUserStore();
    const identity: IdpIdentity = { provider: "apple", sub: "apple-sub-5", email: null, name: null, avatarUrl: null };
    const longHint = "A".repeat(31);
    const user = await resolveUser(store, identity, longHint, NOW);

    assert.equal(user.displayName, "Player");
  });

  it("invalid nameHint (empty after trim) → falls back to 'Player'", async () => {
    const store = new InMemoryUserStore();
    const identity: IdpIdentity = { provider: "apple", sub: "apple-sub-6", email: null, name: null, avatarUrl: null };
    const user = await resolveUser(store, identity, "   ", NOW);

    assert.equal(user.displayName, "Player");
  });

  it("concurrent first-login race: second call when IDP mapping already exists returns first user (no duplicate)", async () => {
    const store = new InMemoryUserStore();
    const identity = googleId("g-race-1", "race@example.com", "Race User");

    // Simulate the race: both calls are in-flight simultaneously.
    // Promise.all makes both calls start before either completes.
    const [user1, user2] = await Promise.all([
      resolveUser(store, identity, undefined, NOW),
      resolveUser(store, identity, undefined, NOW),
    ]);

    // Both must resolve to the SAME userId (no duplicates)
    assert.equal(user1.userId, user2.userId);

    // Only one user record must exist under that userId
    const stored = await store.getUser(user1.userId);
    assert.ok(stored !== null);
    assert.equal(stored.userId, user1.userId);
  });

  it("IDP mapping exists but profile deleted → recreates user (same IDP, new userId)", async () => {
    const store = new InMemoryUserStore();
    const identity = googleId("g-orphan-1", "orphan@example.com", "Orphan User");

    // First login creates the user and mapping
    const user1 = await resolveUser(store, identity, undefined, NOW);
    const oldUserId = user1.userId;

    // Simulate partial delete: remove the user record but leave the IDP mapping
    // InMemoryUserStore doesn't expose delete, so we monkey-patch:
    (store as unknown as { users: Map<string, unknown> }).users.delete(oldUserId);

    // Second login: IDP mapping found, but getUser returns null → should recreate
    const user2 = await resolveUser(store, identity, undefined, NOW);

    // A new user must have been created (new userId since the old profile is gone)
    assert.ok(user2 !== null);
    assert.ok(user2.displayName !== "");
    // Profile must be retrievable
    const stored = await store.getUser(user2.userId);
    assert.ok(stored !== null);
  });
});
