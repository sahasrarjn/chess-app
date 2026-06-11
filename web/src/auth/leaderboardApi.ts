import { checkResponse } from "./api";

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  avatarUrl: string | null;
  wins: number;
  games: number;
}

export interface LeaderboardMe {
  rank: number | null; // null ⇒ outside the top 100 (render as "—")
  displayName: string;
  avatarUrl: string | null;
  wins: number;
  games: number;
  stats: Record<string, number>;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  me: LeaderboardMe | null;
}

/** Public endpoint; the token only adds the caller's own `me` entry. */
export async function fetchLeaderboard(
  baseUrl: string,
  token?: string | null,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<LeaderboardResponse> {
  const res = await fetchImpl(`${baseUrl}/v1/leaderboard`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  await checkResponse(res);
  return res.json() as Promise<LeaderboardResponse>;
}

export function winRateText(wins: number, games: number): string {
  if (games <= 0) return "—";
  return `${Math.round((wins / games) * 100)}%`;
}

export interface StatLine {
  label: string;
  w: number;
  l: number;
  d: number;
}

/** "Your stats" rows from the flat map: Online first, then bot per
 *  difficulty. Rows with zero games are omitted. */
export function statLines(stats: Record<string, number>): StatLine[] {
  const lines: StatLine[] = [];
  const online: StatLine = {
    label: "Online",
    w: stats.online_w ?? 0,
    l: stats.online_l ?? 0,
    d: stats.online_d ?? 0,
  };
  if (online.w + online.l + online.d > 0) lines.push(online);
  for (const diff of ["easy", "medium", "hard"] as const) {
    const line: StatLine = {
      label: `Bot · ${diff}`,
      w: stats[`bot_${diff}_w`] ?? 0,
      l: stats[`bot_${diff}_l`] ?? 0,
      d: stats[`bot_${diff}_d`] ?? 0,
    };
    if (line.w + line.l + line.d > 0) lines.push(line);
  }
  return lines;
}
