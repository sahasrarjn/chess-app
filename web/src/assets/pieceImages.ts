import type { Piece } from "../engine/types";
import { pieceAssetName } from "../engine/types";

import bB from "../../public/pieces/bB.svg?raw";
import bK from "../../public/pieces/bK.svg?raw";
import bN from "../../public/pieces/bN.svg?raw";
import bP from "../../public/pieces/bP.svg?raw";
import bQ from "../../public/pieces/bQ.svg?raw";
import bR from "../../public/pieces/bR.svg?raw";
import wB from "../../public/pieces/wB.svg?raw";
import wK from "../../public/pieces/wK.svg?raw";
import wN from "../../public/pieces/wN.svg?raw";
import wP from "../../public/pieces/wP.svg?raw";
import wQ from "../../public/pieces/wQ.svg?raw";
import wR from "../../public/pieces/wR.svg?raw";

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const BUNDLED_PIECES: Record<string, string> = {
  wP: svgDataUrl(wP),
  wN: svgDataUrl(wN),
  wB: svgDataUrl(wB),
  wR: svgDataUrl(wR),
  wQ: svgDataUrl(wQ),
  wK: svgDataUrl(wK),
  bP: svgDataUrl(bP),
  bN: svgDataUrl(bN),
  bB: svgDataUrl(bB),
  bR: svgDataUrl(bR),
  bQ: svgDataUrl(bQ),
  bK: svgDataUrl(bK),
};

/** Piece image src - inlined in prod (no extra requests); /play/pieces/ in dev. */
export function pieceImgSrc(piece: Piece): string {
  const name = pieceAssetName(piece);
  if (import.meta.env.DEV) {
    return `${import.meta.env.BASE_URL}pieces/${name}.svg`;
  }
  return BUNDLED_PIECES[name] ?? `${import.meta.env.BASE_URL}pieces/${name}.svg`;
}
