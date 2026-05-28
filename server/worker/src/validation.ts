const FEN_BOARD = /^[.1-9/prnbqkRNBQKPN]+(?:\/[.1-9/prnbqkRNBQKPN]+){9}/;
const FEN_TAIL = / [wb] (?:[KQkq-]+|-) (?:[a-j][1-9]|-) \d+ \d+$/;
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
