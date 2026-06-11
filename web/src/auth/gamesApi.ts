import { checkResponse } from "./api";
import type { CompletedGameRecord } from "../game/gameHistory";

export interface GamePage {
  games: CompletedGameRecord[];
  nextCursor: string | null;
}

export async function postGame(
  baseUrl: string,
  token: string,
  record: CompletedGameRecord,
  fetchImpl: typeof fetch = fetch
): Promise<CompletedGameRecord> {
  const res = await fetchImpl(`${baseUrl}/v1/games`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(record),
  });
  await checkResponse(res);
  const data = (await res.json()) as { game: CompletedGameRecord };
  return data.game;
}

export async function listGames(
  baseUrl: string,
  token: string,
  cursor?: string | null,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<GamePage> {
  const url = cursor
    ? `${baseUrl}/v1/games?cursor=${encodeURIComponent(cursor)}`
    : `${baseUrl}/v1/games`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  await checkResponse(res);
  return res.json() as Promise<GamePage>;
}

export async function getGame(
  baseUrl: string,
  token: string,
  gameId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<CompletedGameRecord> {
  const res = await fetchImpl(`${baseUrl}/v1/games/${gameId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  await checkResponse(res);
  const data = (await res.json()) as { game: CompletedGameRecord };
  return data.game;
}
