const FEN_BOARD = /^[.1-9/prnbqkRNBQKPN]+(?:\/[.1-9/prnbqkRNBQKPN]+){9}/;
const FEN_TAIL = / [wb] (?:[KQkq-]+|-) (?:[a-j](?:10|[1-9])|-) \d+ \d+$/;
const MAX_FEN_LENGTH = 200;

export type MovePayload = {
  fen: string;
  elo: number;
  movetime_ms: number;
};

export function parseMovePayload(raw: string): MovePayload | { error: string } {
  if (raw.length > 4096) return { error: "Request body too large" };

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: "Invalid JSON" };
  }

  if (!body || typeof body !== "object") return { error: "Invalid JSON body" };

  const record = body as Record<string, unknown>;
  const fen = typeof record.fen === "string" ? record.fen.trim() : "";
  const elo = record.elo;
  const movetimeMs = record.movetime_ms;

  if (!fen || fen.length > MAX_FEN_LENGTH) return { error: "Invalid FEN" };
  if (/[\n\r\u0000]/.test(fen)) return { error: "Invalid FEN characters" };

  const normalized = fen.replace(/\s+/g, " ");
  if (!FEN_BOARD.test(normalized) || !FEN_TAIL.test(normalized)) {
    return { error: "Invalid FEN format" };
  }

  if (typeof elo !== "number" || !Number.isFinite(elo) || elo < 800 || elo > 3200) {
    return { error: "Invalid elo" };
  }
  if (
    typeof movetimeMs !== "number" ||
    !Number.isFinite(movetimeMs) ||
    movetimeMs < 50 ||
    movetimeMs > 30_000
  ) {
    return { error: "Invalid movetime_ms" };
  }

  return { fen: normalized, elo, movetime_ms: movetimeMs };
}

export function clampPublicMovetime(movetimeMs: number, maxMs: number): number {
  return Math.min(movetimeMs, maxMs);
}

export const ANALYZE_MAX_MOVETIME_MS = 1000;
const ANALYZE_MAX_BODY = 16_384;
const MAX_ANALYZE_MOVES = 1024;
const UCI_MOVE = /^[a-j](?:10|[1-9])[a-j](?:10|[1-9])[qrbn]?$/;

export type AnalyzePayload = {
  fen?: string;
  moves?: string[];
  movetime_ms: number;
};

export function parseAnalyzePayload(raw: string): AnalyzePayload | { error: string } {
  if (raw.length > ANALYZE_MAX_BODY) return { error: "Request body too large" };

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: "Invalid JSON" };
  }
  if (!body || typeof body !== "object") return { error: "Invalid JSON body" };
  const record = body as Record<string, unknown>;

  let fen: string | undefined;
  if (record.fen != null) {
    if (typeof record.fen !== "string") return { error: "Invalid FEN" };
    const trimmed = record.fen.trim();
    if (!trimmed || trimmed.length > MAX_FEN_LENGTH) return { error: "Invalid FEN" };
    if (/[\n\r ]/.test(trimmed)) return { error: "Invalid FEN characters" };
    const normalized = trimmed.replace(/\s+/g, " ");
    if (!FEN_BOARD.test(normalized) || !FEN_TAIL.test(normalized)) {
      return { error: "Invalid FEN format" };
    }
    fen = normalized;
  }

  let moves: string[] | undefined;
  if (record.moves != null) {
    if (!Array.isArray(record.moves) || record.moves.length > MAX_ANALYZE_MOVES) {
      return { error: "Invalid moves" };
    }
    if (!record.moves.every((m) => typeof m === "string" && UCI_MOVE.test(m))) {
      return { error: "Invalid moves" };
    }
    moves = record.moves as string[];
  }

  if (!fen && !moves) return { error: "fen or moves is required" };

  const movetimeMs = record.movetime_ms ?? 200;
  if (
    typeof movetimeMs !== "number" ||
    !Number.isFinite(movetimeMs) ||
    movetimeMs < 50 ||
    movetimeMs > 30_000
  ) {
    return { error: "Invalid movetime_ms" };
  }

  return { fen, moves, movetime_ms: movetimeMs };
}
