import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  uploadCompletedGame,
  flushPendingUploads,
  PENDING_UPLOADS_KEY,
} from "./gameUploads";
import type { CompletedGameRecord } from "./gameHistory";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function readQueue(storage: ReturnType<typeof fakeStorage>): CompletedGameRecord[] {
  const raw = storage.getItem(PENDING_UPLOADS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CompletedGameRecord[];
  } catch {
    return [];
  }
}

function sampleRecord(overrides: Partial<CompletedGameRecord> = {}): CompletedGameRecord {
  return {
    gameId: "g001",
    mode: "vsBot",
    difficulty: "medium",
    playerColor: "white",
    opponent: "Bot (medium)",
    moves: ["e2e4", "e7e5"],
    resultType: "checkmate",
    winner: "white",
    endedAt: "2024-01-01T12:00:00.000Z",
    ...overrides,
  };
}

function makeSuccessFetch(responseRecord: CompletedGameRecord): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ game: responseRecord }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

function makeErrorFetch(status: number): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ error: "fail" }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

function makeNetworkErrorFetch(): typeof fetch {
  return async () => {
    throw new TypeError("Network error");
  };
}

describe("uploadCompletedGame — guest (no token)", () => {
  it("stores nothing when getToken returns null", async () => {
    const storage = fakeStorage();
    await uploadCompletedGame(sampleRecord(), {
      storage,
      getToken: () => null,
      fetchImpl: makeSuccessFetch(sampleRecord()),
      baseUrl: "https://api.example.com",
    });
    assert.deepEqual(readQueue(storage), []);
  });
});

describe("uploadCompletedGame — online mode skipped", () => {
  it("does not enqueue online games (server-recorded)", async () => {
    const storage = fakeStorage();
    await uploadCompletedGame(sampleRecord({ mode: "online" }), {
      storage,
      getToken: () => "tok_abc",
      fetchImpl: makeSuccessFetch(sampleRecord()),
      baseUrl: "https://api.example.com",
    });
    assert.deepEqual(readQueue(storage), []);
  });
});

describe("uploadCompletedGame — signed-in, success", () => {
  it("POSTs immediately and leaves queue empty on success", async () => {
    const storage = fakeStorage();
    const serverRecord = { ...sampleRecord(), gameId: "server-id-001" };
    await uploadCompletedGame(sampleRecord(), {
      storage,
      getToken: () => "tok_abc",
      fetchImpl: makeSuccessFetch(serverRecord),
      baseUrl: "https://api.example.com",
    });
    assert.deepEqual(readQueue(storage), []);
  });
});

describe("uploadCompletedGame — signed-in, network error keeps record queued", () => {
  it("enqueues when network fails", async () => {
    const storage = fakeStorage();
    await uploadCompletedGame(sampleRecord({ gameId: "g-net-err" }), {
      storage,
      getToken: () => "tok_abc",
      fetchImpl: makeNetworkErrorFetch(),
      baseUrl: "https://api.example.com",
    });
    const queue = readQueue(storage);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].gameId, "g-net-err");
  });

  it("second flushPendingUploads with working fetch drains the queue", async () => {
    const storage = fakeStorage();
    const r = sampleRecord({ gameId: "g-retry" });
    // First attempt fails
    await uploadCompletedGame(r, {
      storage,
      getToken: () => "tok_abc",
      fetchImpl: makeNetworkErrorFetch(),
      baseUrl: "https://api.example.com",
    });
    assert.equal(readQueue(storage).length, 1);

    // Second flush with working fetch
    await flushPendingUploads({
      storage,
      getToken: () => "tok_abc",
      fetchImpl: makeSuccessFetch({ ...r, gameId: "server-id" }),
      baseUrl: "https://api.example.com",
    });
    assert.deepEqual(readQueue(storage), []);
  });
});

describe("flushPendingUploads — 400 drops entry", () => {
  it("400 response removes the entry from the queue", async () => {
    const storage = fakeStorage();
    const r = sampleRecord({ gameId: "g-400" });
    await uploadCompletedGame(r, {
      storage,
      getToken: () => "tok_abc",
      fetchImpl: makeNetworkErrorFetch(), // enqueue first
      baseUrl: "https://api.example.com",
    });
    assert.equal(readQueue(storage).length, 1);

    await flushPendingUploads({
      storage,
      getToken: () => "tok_abc",
      fetchImpl: makeErrorFetch(400),
      baseUrl: "https://api.example.com",
    });
    assert.deepEqual(readQueue(storage), []); // 400 = permanently invalid, drop
  });
});

describe("flushPendingUploads — 401 keeps entry", () => {
  it("401 response keeps the entry in the queue", async () => {
    const storage = fakeStorage();
    const r = sampleRecord({ gameId: "g-401" });
    await uploadCompletedGame(r, {
      storage,
      getToken: () => "tok_abc",
      fetchImpl: makeNetworkErrorFetch(), // enqueue first
      baseUrl: "https://api.example.com",
    });
    assert.equal(readQueue(storage).length, 1);

    await flushPendingUploads({
      storage,
      getToken: () => "tok_abc",
      fetchImpl: makeErrorFetch(401),
      baseUrl: "https://api.example.com",
    });
    assert.equal(readQueue(storage).length, 1); // 401 = kept for next boot
  });
});

describe("queue capping", () => {
  it("caps at 10: 11th enqueue drops the oldest", async () => {
    const storage = fakeStorage();
    // Enqueue 11 records using network error to force queuing
    for (let i = 0; i < 11; i++) {
      await uploadCompletedGame(sampleRecord({ gameId: `g${i}`, moves: [`e2e${3 + i}`, "a0a1"] }), {
        storage,
        getToken: () => "tok_abc",
        fetchImpl: makeNetworkErrorFetch(),
        baseUrl: "https://api.example.com",
      });
    }
    const queue = readQueue(storage);
    assert.equal(queue.length, 10);
    // g0 (first/oldest) should be dropped
    assert.ok(!queue.some((r) => r.gameId === "g0"), "oldest should be dropped");
    assert.ok(queue.some((r) => r.gameId === "g10"), "newest should be kept");
  });
});

describe("corrupt queue JSON", () => {
  it("corrupt JSON in storage resets queue to empty", async () => {
    const storage = fakeStorage({ [PENDING_UPLOADS_KEY]: "{{not-json" });
    // Should not throw
    await flushPendingUploads({
      storage,
      getToken: () => "tok_abc",
      fetchImpl: makeSuccessFetch(sampleRecord()),
      baseUrl: "https://api.example.com",
    });
    // Queue should be reset (either empty or not corrupt)
    const raw = storage.getItem(PENDING_UPLOADS_KEY);
    if (raw) {
      assert.doesNotThrow(() => JSON.parse(raw));
    }
  });
});
