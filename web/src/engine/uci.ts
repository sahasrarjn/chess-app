import {
  BOARD_SIZE,
  fromEngineNotation,
  fromStandardNotation,
  type PieceKind,
  type Square,
} from "./types";

export type UciSquares = { from: Square; to: Square; promotion?: PieceKind };

function promotionFromUciSuffix(trimmed: string): PieceKind | undefined {
  if (trimmed.length <= 4) return undefined;
  const ch = trimmed[4]?.toUpperCase();
  if (ch && ["Q", "R", "B", "N"].includes(ch)) return ch as PieceKind;
  return undefined;
}

/**
 * Fairy-Stockfish may return inner-board moves as standard a–h/1–8 UCI (d7d5)
 * or full-grid engine UCI (h9g7). Try every plausible coordinate mapping.
 */
export function resolveUciInterpretations(uci: string): UciSquares[] {
  const trimmed = uci.trim().toLowerCase();
  if (trimmed.length < 4) return [];

  const out: UciSquares[] = [];
  const seen = new Set<string>();
  const push = (from: Square, to: Square, promotion?: PieceKind): void => {
    const key = `${from.row},${from.col},${to.row},${to.col},${promotion ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ from, to, promotion });
  };

  const suffixPromo = promotionFromUciSuffix(trimmed);

  const engineParsed = parseEngineMove(trimmed);
  if (engineParsed) {
    push(
      engineParsed.from,
      engineParsed.to,
      engineParsed.promotion ?? suffixPromo
    );
  }

  const fromStr = trimmed.slice(0, 2);
  const toStr = trimmed.slice(2, 4);
  const fromStd = fromStandardNotation(fromStr);
  const toStd = fromStandardNotation(toStr);
  if (fromStd && toStd) push(fromStd, toStd, suffixPromo);

  const fromMix = fromStandardNotation(fromStr) ?? fromEngineNotation(fromStr);
  const toMix = fromStandardNotation(toStr) ?? fromEngineNotation(toStr);
  if (fromMix && toMix) push(fromMix, toMix, suffixPromo);

  return out;
}

export function parseEngineMove(
  uci: string
): { from: Square; to: Square; promotion?: PieceKind } | null {
  const trimmed = uci.trim().toLowerCase();
  if (trimmed.length < 4) return null;

  let index = 0;
  const from = parseEngineSquare(trimmed, index);
  if (!from) return null;
  index = from.nextIndex;

  const to = parseEngineSquare(trimmed, index);
  if (!to) return null;
  index = to.nextIndex;

  let promotion: PieceKind | undefined;
  if (index < trimmed.length) {
    const ch = trimmed[index].toUpperCase();
    if (["Q", "R", "B", "N"].includes(ch)) {
      promotion = ch as PieceKind;
    }
  }

  return { from: from.square, to: to.square, promotion };
}

function parseEngineSquare(
  text: string,
  start: number
): { square: Square; nextIndex: number } | null {
  if (start >= text.length) return null;
  const file = text.charCodeAt(start) - 97;
  if (file < 0 || file > 9) return null;
  let index = start + 1;
  if (index >= text.length) return null;

  let rankEnd = index + 1;
  if (text[index] === "1" && rankEnd < text.length && text[rankEnd] === "0") {
    rankEnd += 1;
  }
  const rank = parseInt(text.slice(index, rankEnd), 10);
  if (rank < 1 || rank > BOARD_SIZE) return null;
  index = rankEnd;

  const parsed = fromEngineNotation(
    String.fromCharCode(97 + file) + (rank === 10 ? "10" : String(rank))
  );
  if (!parsed) return null;
  return { square: parsed, nextIndex: index };
}
