export type Provider = "google" | "apple";

export interface Profile {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string; // ISO 8601
}

export interface LoginRequest {
  provider: Provider;
  idToken: string;
  /** Display-name hint. Apple sends the user's name only client-side on
   *  FIRST authorization; clients forward it here. Used only at creation. */
  name?: string;
}

export interface LoginResponse {
  token: string;
  profile: Profile;
}

export interface MeResponse {
  profile: Profile;
}

export interface UpdateMeRequest {
  displayName: string;
}

export interface ErrorResponse {
  error: string;
}

const MAX_ID_TOKEN_LENGTH = 4096;

export function parseLoginRequest(raw: string | undefined | null): LoginRequest | null {
  const m = parseObject(raw);
  if (!m) return null;
  if (m.provider !== "google" && m.provider !== "apple") return null;
  if (typeof m.idToken !== "string" || m.idToken.length === 0 || m.idToken.length > MAX_ID_TOKEN_LENGTH) {
    return null;
  }
  const req: LoginRequest = { provider: m.provider, idToken: m.idToken };
  if (typeof m.name === "string" && m.name.trim().length > 0 && m.name.length <= 200) {
    req.name = m.name;
  }
  return req;
}

export function parseUpdateMeRequest(raw: string | undefined | null): UpdateMeRequest | null {
  const m = parseObject(raw);
  if (!m || typeof m.displayName !== "string") return null;
  return { displayName: m.displayName };
}

/** Trim + collapse whitespace; valid at 1–30 chars, else null. */
export function validateDisplayName(name: string): string | null {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (cleaned.length < 1 || cleaned.length > 30) return null;
  return cleaned;
}

function parseObject(raw: string | undefined | null): Record<string, unknown> | null {
  if (!raw) return null;
  if (raw.length > 8192) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

export type RecordableMode = "vsBot" | "localTwoPlayer";
export type GameResultType = "checkmate" | "stalemate" | "resignation" | "draw";
export type RecordColor = "white" | "black";

export interface GameRecordInput {
  mode: RecordableMode;
  difficulty: "easy" | "medium" | "hard" | null;
  playerColor: RecordColor | null;
  opponent: string;
  moves: string[];
  resultType: GameResultType;
  winner: RecordColor | null;
  endedAt: string; // ISO 8601
}

export interface GameRecord extends GameRecordInput {
  gameId: string;
}

export interface GamesPage {
  games: GameRecord[];
  nextCursor: string | null;
}

const MAX_MOVES = 1024;
const MAX_OPPONENT = 40;

/** Light validation per spec: shape + bounds, no server-side move replay. */
export function parseGameRecordInput(raw: string | undefined | null): GameRecordInput | null {
  const m = parseObject(raw);
  if (!m) return null;
  if (m.mode !== "vsBot" && m.mode !== "localTwoPlayer") return null;

  const difficulty =
    m.difficulty === "easy" || m.difficulty === "medium" || m.difficulty === "hard"
      ? m.difficulty
      : null;
  if (m.mode === "vsBot" && difficulty === null) return null;
  if (m.mode === "localTwoPlayer" && m.difficulty != null) return null;

  const playerColor = m.playerColor === "white" || m.playerColor === "black" ? m.playerColor : null;
  if (m.mode === "vsBot" && playerColor === null) return null;

  if (typeof m.opponent !== "string") return null;
  const opponent = m.opponent.replace(/\s+/g, " ").trim();
  if (opponent.length < 1 || opponent.length > MAX_OPPONENT) return null;

  if (!Array.isArray(m.moves) || m.moves.length < 1 || m.moves.length > MAX_MOVES) return null;
  if (!m.moves.every((mv) => typeof mv === "string" && mv.length >= 2 && mv.length <= 8)) {
    return null;
  }

  const resultType = m.resultType;
  if (
    resultType !== "checkmate" &&
    resultType !== "stalemate" &&
    resultType !== "resignation" &&
    resultType !== "draw"
  ) {
    return null;
  }
  const winner = m.winner === "white" || m.winner === "black" ? m.winner : null;
  const needsWinner = resultType === "checkmate" || resultType === "resignation";
  if (needsWinner && winner === null) return null;
  if (!needsWinner && winner !== null) return null;

  if (typeof m.endedAt !== "string" || Number.isNaN(Date.parse(m.endedAt))) return null;

  return {
    mode: m.mode,
    difficulty,
    playerColor,
    opponent,
    moves: m.moves as string[],
    resultType,
    winner,
    endedAt: m.endedAt,
  };
}

/** Flat stats counter key for a recorded game, or null when the game
 *  doesn't attribute a result to the user (pass-and-play). */
export function statsKeyFor(record: {
  mode: string;
  difficulty: string | null;
  playerColor: string | null;
  winner: string | null;
}): string | null {
  if (record.mode !== "vsBot" || !record.playerColor || !record.difficulty) return null;
  const outcome =
    record.winner == null ? "d" : record.winner === record.playerColor ? "w" : "l";
  return `bot_${record.difficulty}_${outcome}`;
}
