import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthApiError } from "./api";
import {
  fetchLeaderboard,
  winRateText,
  statLines,
  type LeaderboardResponse,
} from "./leaderboardApi";

const BASE_URL = "https://api.example.com";
const TOKEN = "sess_token_abc";

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
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
    calls.push({ url, method: init?.method ?? "GET", headers });
    const json = JSON.stringify(responseBody);
    return new Response(json, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

const sampleResponse: LeaderboardResponse = {
  entries: [
    { rank: 1, displayName: "Alice", avatarUrl: null, wins: 10, games: 12 },
    { rank: 2, displayName: "Bob", avatarUrl: "https://example.com/bob.png", wins: 8, games: 10 },
  ],
  me: null,
};

describe("fetchLeaderboard()", () => {
  it("GETs /v1/leaderboard with NO Authorization header when no token", async () => {
    const { fetchImpl, calls } = makeFetch(200, sampleResponse);
    await fetchLeaderboard(BASE_URL, undefined, fetchImpl);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE_URL}/v1/leaderboard`);
    assert.equal(calls[0].method, "GET");
    assert.ok(!("authorization" in calls[0].headers), "should not send Authorization header");
  });

  it("GETs /v1/leaderboard with Authorization: Bearer <token> when token provided", async () => {
    const { fetchImpl, calls } = makeFetch(200, { ...sampleResponse, me: { rank: 1, displayName: "Me", avatarUrl: null, wins: 10, games: 12, stats: {} } });
    await fetchLeaderboard(BASE_URL, TOKEN, fetchImpl);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers["authorization"], `Bearer ${TOKEN}`);
  });

  it("also omits Authorization header when token is null", async () => {
    const { fetchImpl, calls } = makeFetch(200, sampleResponse);
    await fetchLeaderboard(BASE_URL, null, fetchImpl);
    assert.ok(!("authorization" in calls[0].headers), "null token should not send Authorization");
  });

  it("throws AuthApiError with status on non-2xx response", async () => {
    const { fetchImpl } = makeFetch(503, { error: "Service unavailable" });
    await assert.rejects(
      () => fetchLeaderboard(BASE_URL, undefined, fetchImpl),
      (err: unknown) => {
        assert.ok(err instanceof AuthApiError);
        assert.equal(err.status, 503);
        return true;
      }
    );
  });

  it("throws AuthApiError with status 401 on unauthorized", async () => {
    const { fetchImpl } = makeFetch(401, { error: "Unauthorized" });
    await assert.rejects(
      () => fetchLeaderboard(BASE_URL, TOKEN, fetchImpl),
      (err: unknown) => {
        assert.ok(err instanceof AuthApiError);
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it("parses and returns {entries, me: null}", async () => {
    const { fetchImpl } = makeFetch(200, sampleResponse);
    const result = await fetchLeaderboard(BASE_URL, undefined, fetchImpl);
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].rank, 1);
    assert.equal(result.entries[0].displayName, "Alice");
    assert.equal(result.entries[0].wins, 10);
    assert.equal(result.entries[0].games, 12);
    assert.equal(result.me, null);
  });

  it("parses and returns {entries, me} when me is present", async () => {
    const meEntry = {
      rank: 3,
      displayName: "Me",
      avatarUrl: null,
      wins: 5,
      games: 7,
      stats: { online_w: 5, online_l: 2, bot_easy_w: 3 },
    };
    const { fetchImpl } = makeFetch(200, { entries: sampleResponse.entries, me: meEntry });
    const result = await fetchLeaderboard(BASE_URL, TOKEN, fetchImpl);
    assert.ok(result.me !== null);
    assert.equal(result.me!.rank, 3);
    assert.equal(result.me!.stats["online_w"], 5);
    assert.equal(result.me!.stats["bot_easy_w"], 3);
  });

  it("passes AbortSignal to fetch when provided", async () => {
    const capturedSignals: Array<AbortSignal | undefined> = [];
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedSignals.push(init?.signal as AbortSignal | undefined);
      return new Response(JSON.stringify(sampleResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const ctrl = new AbortController();
    await fetchLeaderboard(BASE_URL, undefined, fetchImpl as typeof fetch, ctrl.signal);
    assert.equal(capturedSignals.length, 1);
    assert.ok(capturedSignals[0] === ctrl.signal, "signal should be threaded into fetch");
  });
});

describe("winRateText()", () => {
  it('returns "75%" for wins=3, games=4', () => {
    assert.equal(winRateText(3, 4), "75%");
  });

  it('returns "—" when games is 0', () => {
    assert.equal(winRateText(0, 0), "—");
  });

  it('returns "33%" for wins=1, games=3 (rounds)', () => {
    assert.equal(winRateText(1, 3), "33%");
  });

  it('returns "0%" for wins=0, games=5', () => {
    assert.equal(winRateText(0, 5), "0%");
  });

  it('returns "100%" for wins=5, games=5', () => {
    assert.equal(winRateText(5, 5), "100%");
  });

  it('returns "—" when games is negative (treated as 0)', () => {
    assert.equal(winRateText(0, -1), "—");
  });
});

describe("statLines()", () => {
  it("returns [] for empty stats", () => {
    assert.deepEqual(statLines({}), []);
  });

  it("returns online row first, then bot difficulty rows; omits zero-game rows", () => {
    const result = statLines({
      online_w: 2,
      online_l: 1,
      bot_medium_w: 3,
      bot_medium_d: 1,
    });
    assert.equal(result.length, 2);
    assert.equal(result[0].label, "Online");
    assert.equal(result[0].w, 2);
    assert.equal(result[0].l, 1);
    assert.equal(result[0].d, 0);
    assert.equal(result[1].label, "Bot · medium");
    assert.equal(result[1].w, 3);
    assert.equal(result[1].l, 0);
    assert.equal(result[1].d, 1);
  });

  it("orders bot difficulties easy/medium/hard regardless of input key order", () => {
    const result = statLines({
      bot_hard_w: 1,
      bot_easy_l: 2,
      bot_medium_d: 1,
    });
    assert.equal(result.length, 3);
    assert.equal(result[0].label, "Bot · easy");
    assert.equal(result[1].label, "Bot · medium");
    assert.equal(result[2].label, "Bot · hard");
  });

  it("omits bot rows that have zero total games", () => {
    const result = statLines({
      online_w: 1,
      bot_easy_w: 0,
      bot_easy_l: 0,
      bot_easy_d: 0,
      bot_hard_w: 2,
    });
    // only online + hard; easy omitted
    assert.equal(result.length, 2);
    assert.equal(result[0].label, "Online");
    assert.equal(result[1].label, "Bot · hard");
  });

  it("omits online row when all online counters are zero or missing", () => {
    const result = statLines({ bot_easy_w: 5 });
    assert.equal(result.length, 1);
    assert.equal(result[0].label, "Bot · easy");
  });

  it("handles all three online counters summing to zero", () => {
    const result = statLines({ online_w: 0, online_l: 0, online_d: 0 });
    assert.deepEqual(result, []);
  });
});
