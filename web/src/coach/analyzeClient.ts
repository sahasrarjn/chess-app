import type { ChessGame } from "../engine/chessGame";
import { toFEN } from "../engine/fen";
import { moveUci } from "../engine/types";
import { engineApiBase } from "../bot/engineConfig";
import { evaluateCp } from "../bot/chessBot";
import { chooseLocalBotMove } from "../bot/localBot";

/** Raw engine analysis, side-to-move perspective (NOT yet White-relative). */
export interface EngineAnalysis {
  scoreCp: number | null;
  mateIn: number | null;
  bestMoveUci: string | null;
  pv: string[];
  source: "server" | "local";
}

export const LIVE_MOVETIME_MS = 400;
export const REVIEW_MOVETIME_MS = 200;

export type AnalyzeFn = (
  game: ChessGame,
  movetimeMs: number,
  signal?: AbortSignal
) => Promise<EngineAnalysis>;

const ANALYZE_FETCH_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;
const RETRYABLE_HTTP = new Set([429, 502, 503, 504]);
const RETRY_BACKOFF_MS = 400;

// Copied from remoteEngine.ts (duplication-over-coupling precedent)
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// Copied from remoteEngine.ts
function isRetryableNetworkError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  if (err instanceof DOMException && err.name === "TimeoutError") return true;
  if (err instanceof TypeError) return true;
  return err instanceof Error && /failed to fetch|network|load failed/i.test(err.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function buildLocalFallback(
  game: ChessGame,
  signal?: AbortSignal
): Promise<EngineAnalysis> {
  const scoreCp = evaluateCp(game, game.activeColor);
  const localMove = await chooseLocalBotMove(game.copy(), "hard", undefined, signal);
  const bestMoveUci = localMove ? moveUci(localMove) : null;
  return {
    scoreCp,
    mateIn: null,
    bestMoveUci,
    pv: bestMoveUci ? [bestMoveUci] : [],
    source: "local",
  };
}

export async function analyzePosition(
  game: ChessGame,
  movetimeMs: number = LIVE_MOVETIME_MS,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<EngineAnalysis> {
  const url = `${engineApiBase() || ""}/v1/analyze`;
  const payload = JSON.stringify({ fen: toFEN(game), movetime_ms: movetimeMs });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    // Per-attempt timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), ANALYZE_FETCH_TIMEOUT_MS);

    // Merge caller signal + per-attempt timeout
    const mergedController = new AbortController();
    const mergeAbort = (): void => mergedController.abort();
    signal?.addEventListener("abort", mergeAbort, { once: true });
    timeoutController.signal.addEventListener("abort", mergeAbort, { once: true });

    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: mergedController.signal,
      });

      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", mergeAbort);

      if (!res.ok) {
        if (RETRYABLE_HTTP.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
          await sleep(RETRY_BACKOFF_MS);
          continue;
        }
        // Non-retryable error → local fallback
        return buildLocalFallback(game, signal);
      }

      let data: unknown;
      try {
        const text = await res.text();
        data = JSON.parse(text);
      } catch {
        return buildLocalFallback(game, signal);
      }

      const d = data as {
        score_cp?: number | null;
        mate_in?: number | null;
        best_move_uci?: string | null;
        pv?: string[];
      };

      return {
        scoreCp: d.score_cp ?? null,
        mateIn: d.mate_in ?? null,
        bestMoveUci: d.best_move_uci ?? null,
        pv: Array.isArray(d.pv) ? d.pv : [],
        source: "server",
      };
    } catch (err) {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", mergeAbort);

      if (isAbortError(err)) {
        // If the caller's signal aborted, rethrow (not a local fallback situation)
        if (signal?.aborted) throw err;
        // Otherwise it was our timeout — treat as retryable
      }

      if (isRetryableNetworkError(err) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }

      if (isAbortError(err) && !signal?.aborted) {
        // Our timeout fired but caller didn't abort → local fallback
        return buildLocalFallback(game, signal);
      }

      // Any other non-abort failure → local fallback
      return buildLocalFallback(game, signal);
    }
  }

  return buildLocalFallback(game, signal);
}
