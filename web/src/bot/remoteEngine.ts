import type { ChessGame } from "../engine/chessGame";
import { matchEngineMove } from "../engine/fen";
import { toFEN } from "../engine/fen";
import type { BotDifficulty, Move } from "../engine/types";
import { difficultyElo, difficultyMovetime } from "../engine/types";
import { engineApiBase } from "./engineConfig";

const FETCH_TIMEOUT_MS = 30_000;

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

export async function fetchBotMove(
  game: ChessGame,
  difficulty: BotDifficulty,
  signal?: AbortSignal
): Promise<Move | null> {
  const base = engineApiBase();
  const url = `${base || ""}/v1/move`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);
  const mergedSignal = signal
    ? mergeAbortSignals(signal, timeoutController.signal)
    : timeoutController.signal;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        fen: toFEN(game),
        elo: difficultyElo(difficulty),
        movetime_ms: difficultyMovetime(difficulty),
      }),
      signal: mergedSignal,
    });
  } catch (err) {
    if (timeoutController.signal.aborted && !(signal?.aborted ?? false)) {
      throw new DOMException("Engine request timed out", "TimeoutError");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await res.text();
  if (!res.ok) {
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
    throw new Error(base + retryHint);
  }

  const data = JSON.parse(text) as { uci?: string };
  if (!data.uci) return null;
  return matchEngineMove(game, data.uci);
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
