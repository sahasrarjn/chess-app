import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromFEN, matchEngineMove } from "../engine/fen";
import { evaluateCp } from "../bot/chessBot";
import { analyzePosition, LIVE_MOVETIME_MS, REVIEW_MOVETIME_MS } from "./analyzeClient";
import { START_FEN } from "./testFixtures";

// Helper to build a fake fetch that returns scripted responses
type FetchCall = { url: string; body: string };

function makeFakeFetch(
  responses: Array<{ status: number; body: unknown } | { throw: Error }>
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let idx = 0;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const body = (init?.body as string) ?? "";
    calls.push({ url, body });
    const resp = responses[idx++];
    if (!resp) throw new Error("No more fake responses");
    if ("throw" in resp) throw resp.throw;
    const { status, body: respBody } = resp;
    const text = typeof respBody === "string" ? respBody : JSON.stringify(respBody);
    return new Response(text, { status });
  };
  return { fetch: fakeFetch, calls };
}

const GOOD_RESPONSE = {
  score_cp: 42,
  mate_in: null,
  best_move_uci: "e2e4",
  pv: ["e2e4", "e7e5"],
};

describe("analyzePosition", () => {
  it("success: returns server result with scoreCp/mateIn/bestMoveUci/pv/source", async () => {
    const game = fromFEN(START_FEN);
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      { status: 200, body: GOOD_RESPONSE },
    ]);

    const result = await analyzePosition(game, LIVE_MOVETIME_MS, undefined, fakeFetch);
    assert.equal(result.source, "server");
    assert.equal(result.scoreCp, 42);
    assert.equal(result.mateIn, null);
    assert.equal(result.bestMoveUci, "e2e4");
    assert.deepEqual(result.pv, ["e2e4", "e7e5"]);

    // Request body contains FEN and clamped movetime
    assert.equal(calls.length, 1);
    const reqBody = JSON.parse(calls[0].body);
    assert.ok(reqBody.fen, "body should contain fen");
    assert.equal(reqBody.movetime_ms, LIVE_MOVETIME_MS);
    assert.ok(calls[0].url.endsWith("/v1/analyze"), "URL should end in /v1/analyze");
  });

  it("retryable 503 then 200: succeeds after retry (2 attempts)", async () => {
    const game = fromFEN(START_FEN);
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      { status: 503, body: { error: "unavailable" } },
      { status: 200, body: GOOD_RESPONSE },
    ]);

    const result = await analyzePosition(game, REVIEW_MOVETIME_MS, undefined, fakeFetch);
    assert.equal(result.source, "server");
    assert.equal(result.scoreCp, 42);
    assert.equal(calls.length, 2);
  });

  it("network rejection on all attempts: returns local fallback", async () => {
    const game = fromFEN(START_FEN);
    const networkErr = Object.assign(new TypeError("Failed to fetch"), {});
    const { fetch: fakeFetch } = makeFakeFetch([
      { throw: networkErr },
      { throw: networkErr },
    ]);

    const result = await analyzePosition(game, LIVE_MOVETIME_MS, undefined, fakeFetch);
    assert.equal(result.source, "local");
    assert.equal(result.mateIn, null);
    assert.ok(typeof result.scoreCp === "number", "local scoreCp should be a number");
    // bestMoveUci should be legal in the position (if non-null)
    if (result.bestMoveUci != null) {
      const foundMove = matchEngineMove(game, result.bestMoveUci);
      assert.ok(foundMove, `bestMoveUci '${result.bestMoveUci}' should be legal`);
      assert.deepEqual(result.pv, [result.bestMoveUci]);
    }
  });

  it("400 response: no retry, immediate local fallback", async () => {
    const game = fromFEN(START_FEN);
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      { status: 400, body: { error: "bad fen" } },
    ]);

    const result = await analyzePosition(game, LIVE_MOVETIME_MS, undefined, fakeFetch);
    assert.equal(result.source, "local");
    assert.equal(calls.length, 1); // no retry
  });

  it("malformed JSON body from server: local fallback", async () => {
    const game = fromFEN(START_FEN);
    const { fetch: fakeFetch } = makeFakeFetch([
      { status: 200, body: "not-json{{{}}" },
    ]);

    const result = await analyzePosition(game, LIVE_MOVETIME_MS, undefined, fakeFetch as typeof fetch);
    assert.equal(result.source, "local");
  });

  it("abort: aborted signal rejects with AbortError", async () => {
    const game = fromFEN(START_FEN);
    const abortCtrl = new AbortController();
    abortCtrl.abort();

    // Make fetch that would succeed if called
    const { fetch: fakeFetch } = makeFakeFetch([
      { status: 200, body: GOOD_RESPONSE },
    ]);

    await assert.rejects(
      () => analyzePosition(game, LIVE_MOVETIME_MS, abortCtrl.signal, fakeFetch),
      (err: unknown) => {
        assert.ok(err instanceof DOMException, "should be DOMException");
        assert.equal((err as DOMException).name, "AbortError");
        return true;
      }
    );
  });

  it("movetime passed through to request body", async () => {
    const game = fromFEN(START_FEN);
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      { status: 200, body: GOOD_RESPONSE },
    ]);

    await analyzePosition(game, 200, undefined, fakeFetch);
    const reqBody = JSON.parse(calls[0].body);
    assert.equal(reqBody.movetime_ms, 200);
  });

  it("local fallback scoreCp matches evaluateCp(game, activeColor)", async () => {
    const game = fromFEN(START_FEN);
    const networkErr = new TypeError("Failed to fetch");
    const { fetch: fakeFetch } = makeFakeFetch([
      { throw: networkErr },
      { throw: networkErr },
    ]);

    const result = await analyzePosition(game, LIVE_MOVETIME_MS, undefined, fakeFetch);
    assert.equal(result.source, "local");
    const expected = evaluateCp(game, game.activeColor);
    assert.equal(result.scoreCp, expected);
  });
});
