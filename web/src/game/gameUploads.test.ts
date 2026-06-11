import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  uploadCompletedGame,
  flushPendingUploads,
  clearPendingUploads,
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

// ── NEW TESTS ────────────────────────────────────────────────────────────────

describe("flushPendingUploads — reentrancy guard: concurrent flushes upload each item exactly once", () => {
  it("two concurrent flushes of a two-item queue POST exactly two times (no double-upload)", async () => {
    const storage = fakeStorage();
    // Pre-populate queue with two records
    const r1 = sampleRecord({ gameId: "g-concur-1", moves: ["e2e4"] });
    const r2 = sampleRecord({ gameId: "g-concur-2", moves: ["d2d4"] });

    // Build queue via network-error uploads (enqueue without sending)
    await uploadCompletedGame(r1, {
      storage,
      getToken: () => "tok_abc",
      fetchImpl: async () => { throw new TypeError("net"); },
      baseUrl: "https://api.example.com",
    });
    await uploadCompletedGame(r2, {
      storage,
      getToken: () => "tok_abc",
      fetchImpl: async () => { throw new TypeError("net"); },
      baseUrl: "https://api.example.com",
    });
    assert.equal(readQueue(storage).length, 2);

    // Slow fetch that we can resolve manually
    let resolveFetch1!: () => void;
    let callCount = 0;
    const blockingFetch: typeof fetch = async (input) => {
      callCount++;
      if (callCount === 1) {
        // First call: block until we release
        await new Promise<void>((res) => { resolveFetch1 = res; });
      }
      const url = (input as string).toString();
      void url;
      return new Response(
        JSON.stringify({ game: sampleRecord({ gameId: "server-id" }) }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const deps = {
      storage,
      getToken: () => "tok_abc" as string | null,
      fetchImpl: blockingFetch,
      baseUrl: "https://api.example.com",
    };

    // Start two flushes concurrently — second should coalesce onto the first
    const p1 = flushPendingUploads(deps);
    const p2 = flushPendingUploads(deps);

    // Release the blocking fetch
    resolveFetch1();

    await Promise.all([p1, p2]);

    // Each item should be uploaded exactly once → queue empty
    assert.deepEqual(readQueue(storage), [], "queue must be empty after concurrent flushes");
    // Total POST calls must equal number of items (2), not doubled (4)
    assert.equal(callCount, 2, `expected 2 POSTs, got ${callCount}`);
  });
});

describe("dequeue by id — removes the right item when queue changes between dequeues", () => {
  it("after a concurrent enqueue at the front, dequeue-by-id removes the uploaded item (not the injected one)", async () => {
    const storage = fakeStorage();
    // Pre-load with record r1 at index 0
    const r1 = sampleRecord({ gameId: "id-first", moves: ["e2e4"] });
    const r2 = sampleRecord({ gameId: "id-injected", moves: ["d2d4"] });

    // Enqueue r1 via failed upload
    await uploadCompletedGame(r1, {
      storage,
      getToken: () => "tok_abc",
      fetchImpl: async () => { throw new TypeError("net"); },
      baseUrl: "https://api.example.com",
    });

    let callIndex = 0;
    // First fetch: inject r2 at the front of the queue, then succeed for r1.
    // Second fetch: network error so r2 stays queued (lets us observe which item remains).
    const injectingFetch: typeof fetch = async () => {
      callIndex++;
      if (callIndex === 1) {
        // Inject r2 at the front, simulating a concurrent enqueue between read and dequeue
        const q = JSON.parse(storage.getItem(PENDING_UPLOADS_KEY) ?? "[]") as CompletedGameRecord[];
        storage.setItem(PENDING_UPLOADS_KEY, JSON.stringify([r2, ...q]));
        // Return success for r1
        return new Response(
          JSON.stringify({ game: { ...r1, gameId: "server-r1" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      // Second call (for r2): network error so it stays in queue
      throw new TypeError("net-for-r2");
    };

    await flushPendingUploads({
      storage,
      getToken: () => "tok_abc",
      fetchImpl: injectingFetch as typeof fetch,
      baseUrl: "https://api.example.com",
    });

    // With dequeue-by-id: r1 is correctly removed, r2 remains.
    // With (buggy) dequeue-by-index-0: after injection, index 0 is r2 →
    //   r2 would be silently dropped and r1 would remain unremoved.
    const remaining = readQueue(storage);
    assert.ok(
      !remaining.some((r) => r.gameId === "id-first"),
      "r1 (uploaded successfully) must be removed from queue"
    );
    assert.ok(
      remaining.some((r) => r.gameId === "id-injected"),
      "r2 (network error, not uploaded) must remain in queue"
    );
  });
});

describe("clearPendingUploads", () => {
  it("removes all pending uploads from storage", async () => {
    const storage = fakeStorage();
    // Enqueue a couple of records
    await uploadCompletedGame(sampleRecord({ gameId: "cl-1" }), {
      storage,
      getToken: () => "tok_abc",
      fetchImpl: async () => { throw new TypeError("net"); },
      baseUrl: "https://api.example.com",
    });
    await uploadCompletedGame(sampleRecord({ gameId: "cl-2", moves: ["d2d4"] }), {
      storage,
      getToken: () => "tok_abc",
      fetchImpl: async () => { throw new TypeError("net"); },
      baseUrl: "https://api.example.com",
    });
    assert.equal(readQueue(storage).length, 2, "precondition: two items queued");

    clearPendingUploads(storage);

    assert.deepEqual(readQueue(storage), [], "queue must be empty after clearPendingUploads");
  });

  it("is a no-op when queue is already empty", () => {
    const storage = fakeStorage();
    assert.doesNotThrow(() => clearPendingUploads(storage));
    assert.deepEqual(readQueue(storage), []);
  });
});
