import posthog from "posthog-js";

import type { BotMoveSource } from "../bot/chooseBotMove";

type BotMoveProps = {
  source: BotMoveSource;
  difficulty: string;
  elapsedMs: number;
  ply: number;
  serverError?: string;
  serverUci?: string;
  appliedUci?: string;
  fen?: string;
};

function commonProps(props: BotMoveProps) {
  return {
    source: props.source,
    difficulty: props.difficulty,
    elapsed_ms: Math.round(props.elapsedMs),
    ply: props.ply,
    server_error: props.serverError ?? null,
    server_uci: props.serverUci ?? null,
    applied_uci: props.appliedUci ?? null,
    fen: props.fen ?? null,
  };
}

/** Bot played a move (Fairy-Stockfish or silent minimax fallback). */
export function trackBotMove(props: BotMoveProps): void {
  const usedFallback = props.source === "builtin" && !!props.serverError;
  posthog.capture("bot_move", {
    ...commonProps(props),
    used_fallback: usedFallback,
    outcome: usedFallback ? "fallback" : "server",
  });
}

/** Bot could not play any move; user may see Retry Bot. */
export function trackBotMoveError(props: BotMoveProps & { error: string }): void {
  posthog.capture("bot_move_error", {
    ...commonProps(props),
    error: props.error,
    outcome: "failed",
  });
}

/** User tapped Retry Bot after an engine error. */
export function trackBotRetry(props: {
  difficulty: string;
  ply: number;
  previousError?: string | null;
}): void {
  posthog.capture("bot_retry", {
    difficulty: props.difficulty,
    ply: props.ply,
    previous_error: props.previousError ?? null,
  });
}
