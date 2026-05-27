import { BOARD_SIZE, fromEngineNotation, type PieceKind, type Square } from "./types";

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
