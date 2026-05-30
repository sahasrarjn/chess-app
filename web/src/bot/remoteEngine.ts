import type { ChessGame } from "../engine/chessGame";
import { matchEngineMove } from "../engine/fen";
import { toFEN } from "../engine/fen";
import type { BotDifficulty, Move } from "../engine/types";
import { difficultyElo, difficultyMovetime } from "../engine/types";
import { engineApiBase } from "./engineConfig";

const FETCH_TIMEOUT_MS = 45_000;
const MAX_NETWORK_ATTEMPTS = 3;
const RETRYABLE_HTTP = new Set([429, 502, 503, 504]);

function mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function isRetryableNetworkError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  if (err instanceof DOMException && err.name === "TimeoutError") return true;
  if (err instanceof TypeError) return true;
  return err instanceof Error && /failed to fetch|network|load failed/i.test(err.message);
}

function friendlyNetworkMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return "Engine request timed out";
  }
  if (err instanceof TypeError || (err instanceof Error && /failed to fetch/i.test(err.message))) {
    return "Cannot reach the chess engine (network error)";
  }
  if (err instanceof Error) return err.message;
  return "Cannot reach the chess engine";
}

async function postMoveOnce(
  url: string,
  body: string,
  signal: AbortSignal
): Promise<{ res: Response; text: string }> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);
  const mergedSignal = mergeAbortSignals(signal, timeoutController.signal);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: mergedSignal,
    });
    const text = await res.text();
    return { res, text };
  } catch (err) {
    if (timeoutController.signal.aborted && !signal.aborted) {
      throw new DOMException("Engine request timed out", "TimeoutError");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseMoveError(
  res: Response,
  text: string
): { message: string; retryable: boolean } {
  let detail = text;
  let retryAfterSeconds: number | undefined;
  try {
    const err = JSON.parse(text) as {
      error?: string;
      detail?: string;
      retry_after_seconds?: number;
    };
    detail = err.error ?? err.detail ?? text;
    retryAfterSeconds = err.retry_after_seconds;
  } catch {
    /* use raw text */
  }
  if (retryAfterSeconds == null) {
    const header = res.headers.get("Retry-After");
    if (header) {
      const parsed = parseInt(header, 10);
      if (Number.isFinite(parsed) && parsed > 0) retryAfterSeconds = parsed;
    }
  }
  const base = detail || `Engine HTTP ${res.status}`;
  const retryHint =
    res.status === 429 && retryAfterSeconds != null
      ? ` Retry in ~${retryAfterSeconds}s.`
      : "";
  return {
    message: base + retryHint,
    retryable: RETRYABLE_HTTP.has(res.status),
  };
}

export async function fetchBotMove(
  game: ChessGame,
  difficulty: BotDifficulty,
  signal?: AbortSignal
): Promise<Move | null> {
  const base = engineApiBase();
  const url = `${base || ""}/v1/move`;
  const payload = JSON.stringify({
    fen: toFEN(game),
    elo: difficultyElo(difficulty),
    movetime_ms: difficultyMovetime(difficulty),
  });

  const reqSignal = signal ?? new AbortController().signal;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_NETWORK_ATTEMPTS; attempt++) {
    if (reqSignal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    try {
      const { res, text } = await postMoveOnce(url, payload, reqSignal);
      if (!res.ok) {
        const parsed = parseMoveError(res, text);
        lastError = new Error(parsed.message);
        if (parsed.retryable && attempt < MAX_NETWORK_ATTEMPTS - 1) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw lastError;
      }

      const data = JSON.parse(text) as { uci?: string };
      if (!data.uci) return null;
      return matchEngineMove(game, data.uci);
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (isRetryableNetworkError(err) && attempt < MAX_NETWORK_ATTEMPTS - 1) {
        lastError = new Error(friendlyNetworkMessage(err));
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (err instanceof Error) throw err;
      throw new Error(friendlyNetworkMessage(err));
    }
  }

  throw lastError ?? new Error("Cannot reach the chess engine");
}

export async function checkEngineHealth(): Promise<boolean> {
  try {
    const base = engineApiBase();
    const res = await fetch(`${base || ""}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
