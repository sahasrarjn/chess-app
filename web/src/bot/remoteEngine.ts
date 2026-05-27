import type { ChessGame } from "../engine/chessGame";
import { matchEngineMove } from "../engine/fen";
import { toFEN } from "../engine/fen";
import type { BotDifficulty, Move } from "../engine/types";
import { difficultyElo, difficultyMovetime } from "../engine/types";
import { engineApiBase, getApiKey } from "./engineConfig";

export async function fetchBotMove(
  game: ChessGame,
  difficulty: BotDifficulty
): Promise<Move | null> {
  const base = engineApiBase();
  const url = `${base || ""}/v1/move`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = getApiKey();
  if (apiKey) headers["X-API-Key"] = apiKey;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fen: toFEN(game),
      elo: difficultyElo(difficulty),
      movetime_ms: difficultyMovetime(difficulty),
    }),
  });

  if (!res.ok) {
    throw new Error(`Engine HTTP ${res.status}`);
  }

  const data = (await res.json()) as { uci?: string };
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
