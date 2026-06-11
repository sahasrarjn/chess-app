import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthApiError } from "./api";
import { postGame, listGames, getGame } from "./gamesApi";
import type { CompletedGameRecord } from "../game/gameHistory";

const BASE_URL = "https://api.example.com";
const TOKEN = "sess_token_abc";

function sampleRecord(overrides: Partial<CompletedGameRecord> = {}): CompletedGameRecord {
  return {
    gameId: "local-game-001",
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

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

function makeFetch(
  status: number,
  responseBody: unknown,
  networkError = false
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    if (networkError) throw new TypeError("Network error");
    const url = input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) {
        headers[k.toLowerCase()] = v;
      }
    }
    let parsedBody: unknown = undefined;
    if (init?.body) {
      try {
        parsedBody = JSON.parse(init.body as string);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method: init?.method ?? "GET", headers, body: parsedBody });
    const json = JSON.stringify(responseBody);
    return new Response(json, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

describe("postGame()", () => {
  it("POSTs to /v1/games with Bearer and returns the game", async () => {
    const record = sampleRecord();
    const serverRecord = { ...record, gameId: "server-assigned-id" };
    const { fetchImpl, calls } = makeFetch(200, { game: serverRecord });

    const result = await postGame(BASE_URL, TOKEN, record, fetchImpl);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE_URL}/v1/games`);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers["authorization"], `Bearer ${TOKEN}`);
    assert.equal(calls[0].headers["content-type"], "application/json");
    assert.equal(result.gameId, "server-assigned-id");
  });

  it("sends the record body", async () => {
    const record = sampleRecord();
    const { fetchImpl, calls } = makeFetch(200, { game: record });
    await postGame(BASE_URL, TOKEN, record, fetchImpl);
    const body = calls[0].body as CompletedGameRecord;
    assert.equal(body.mode, "vsBot");
    assert.equal(body.resultType, "checkmate");
    assert.deepEqual(body.moves, ["e2e4", "e7e5"]);
  });

  it("throws AuthApiError on 400", async () => {
    const { fetchImpl } = makeFetch(400, { error: "mode online rejected" });
    await assert.rejects(
      () => postGame(BASE_URL, TOKEN, sampleRecord(), fetchImpl),
      (err: unknown) => {
        assert.ok(err instanceof AuthApiError);
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it("throws AuthApiError on 401", async () => {
    const { fetchImpl } = makeFetch(401, { error: "Unauthorized" });
    await assert.rejects(
      () => postGame(BASE_URL, TOKEN, sampleRecord(), fetchImpl),
      (err: unknown) => {
        assert.ok(err instanceof AuthApiError);
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it("propagates network errors", async () => {
    const { fetchImpl } = makeFetch(0, null, true);
    await assert.rejects(
      () => postGame(BASE_URL, TOKEN, sampleRecord(), fetchImpl),
      (err: unknown) => err instanceof TypeError
    );
  });
});

describe("listGames()", () => {
  it("GETs /v1/games with Bearer and returns games + nextCursor", async () => {
    const games = [sampleRecord()];
    const { fetchImpl, calls } = makeFetch(200, { games, nextCursor: null });
    const result = await listGames(BASE_URL, TOKEN, undefined, fetchImpl);
    assert.equal(calls[0].url, `${BASE_URL}/v1/games`);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].headers["authorization"], `Bearer ${TOKEN}`);
    assert.equal(result.games.length, 1);
    assert.equal(result.nextCursor, null);
  });

  it("appends cursor as a query param when provided", async () => {
    const { fetchImpl, calls } = makeFetch(200, { games: [], nextCursor: null });
    await listGames(BASE_URL, TOKEN, "cursor123", fetchImpl);
    assert.ok(calls[0].url.includes("cursor=cursor123"), `expected cursor in URL: ${calls[0].url}`);
  });

  it("encodes cursor value in the URL", async () => {
    const { fetchImpl, calls } = makeFetch(200, { games: [], nextCursor: null });
    await listGames(BASE_URL, TOKEN, "a+b/c=d", fetchImpl);
    assert.ok(!calls[0].url.includes("a+b/c=d"), "cursor should be encoded");
    assert.ok(calls[0].url.includes(encodeURIComponent("a+b/c=d")));
  });

  it("throws AuthApiError on 401", async () => {
    const { fetchImpl } = makeFetch(401, { error: "Unauthorized" });
    await assert.rejects(
      () => listGames(BASE_URL, TOKEN, undefined, fetchImpl),
      (err: unknown) => {
        assert.ok(err instanceof AuthApiError);
        assert.equal(err.status, 401);
        return true;
      }
    );
  });
});

describe("getGame()", () => {
  it("GETs /v1/games/<id> with Bearer and unwraps {game}", async () => {
    const record = sampleRecord({ gameId: "game-xyz" });
    const { fetchImpl, calls } = makeFetch(200, { game: record });
    const result = await getGame(BASE_URL, TOKEN, "game-xyz", fetchImpl);
    assert.equal(calls[0].url, `${BASE_URL}/v1/games/game-xyz`);
    assert.equal(calls[0].headers["authorization"], `Bearer ${TOKEN}`);
    assert.equal(result.gameId, "game-xyz");
  });

  it("throws AuthApiError on 404", async () => {
    const { fetchImpl } = makeFetch(404, { error: "Not found" });
    await assert.rejects(
      () => getGame(BASE_URL, TOKEN, "missing-id", fetchImpl),
      (err: unknown) => {
        assert.ok(err instanceof AuthApiError);
        assert.equal(err.status, 404);
        return true;
      }
    );
  });
});

// ── NEW: AbortSignal threading (item 4) ──────────────────────────────────────

function makeAbortCapturingFetch(status: number, responseBody: unknown): {
  fetchImpl: typeof fetch;
  capturedSignals: Array<AbortSignal | undefined>;
} {
  const capturedSignals: Array<AbortSignal | undefined> = [];
  const fetchImpl = async (
    _input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    capturedSignals.push(init?.signal as AbortSignal | undefined);
    if (init?.signal?.aborted) {
      const err = new DOMException("Aborted", "AbortError");
      throw err;
    }
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl: fetchImpl as typeof fetch, capturedSignals };
}

describe("listGames() — AbortSignal threading", () => {
  it("passes signal to fetch when provided", async () => {
    const { fetchImpl, capturedSignals } = makeAbortCapturingFetch(200, { games: [], nextCursor: null });
    const ctrl = new AbortController();
    await listGames(BASE_URL, TOKEN, undefined, fetchImpl, ctrl.signal);
    assert.equal(capturedSignals.length, 1);
    assert.ok(capturedSignals[0] === ctrl.signal, "signal should be threaded into fetch");
  });

  it("throws when the signal is already aborted before the call", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { fetchImpl } = makeAbortCapturingFetch(200, { games: [], nextCursor: null });
    await assert.rejects(
      () => listGames(BASE_URL, TOKEN, undefined, fetchImpl, ctrl.signal),
      (err: unknown) => (err as { name?: string }).name === "AbortError"
    );
  });
});

describe("getGame() — AbortSignal threading", () => {
  it("passes signal to fetch when provided", async () => {
    const record = sampleRecord({ gameId: "abc" });
    const { fetchImpl, capturedSignals } = makeAbortCapturingFetch(200, { game: record });
    const ctrl = new AbortController();
    await getGame(BASE_URL, TOKEN, "abc", fetchImpl, ctrl.signal);
    assert.equal(capturedSignals.length, 1);
    assert.ok(capturedSignals[0] === ctrl.signal, "signal should be threaded into fetch");
  });
});
