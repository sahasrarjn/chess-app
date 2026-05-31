import type { ChessGame } from "../engine/chessGame";
import type { BotDifficulty, Move } from "../engine/types";
import { chooseMinimaxMoveTimed } from "./chessBot";
import type { BotWorkerRequest, BotWorkerResponse } from "./botWorker";

/** Max time for offline minimax so the tab stays responsive. */
export const LOCAL_BOT_MAX_MS = 2500;

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./botWorker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

export function preloadLocalBotWorker(): void {
  if (typeof Worker === "undefined") return;
  getWorker();
}

export async function chooseLocalBotMove(
  game: ChessGame,
  difficulty: BotDifficulty,
  maxMs = LOCAL_BOT_MAX_MS,
  signal?: AbortSignal
): Promise<Move | null> {
  if (typeof Worker === "undefined") {
    return chooseMinimaxMoveTimed(game, difficulty, maxMs);
  }

  const payload: BotWorkerRequest = {
    state: game.toSearchState(),
    difficulty,
    maxMs,
  };

  return new Promise((resolve) => {
    const w = getWorker();
    let settled = false;

    const finish = (move: Move | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(move);
    };

    const onMessage = (event: MessageEvent<BotWorkerResponse>): void => {
      finish(event.data.move ?? null);
    };

    const onError = (): void => {
      finish(null);
    };

    const onAbort = (): void => {
      finish(null);
    };

    const timeoutId = setTimeout(() => finish(null), maxMs + 500);

    const cleanup = (): void => {
      clearTimeout(timeoutId);
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });

    w.postMessage(payload);
  });
}
