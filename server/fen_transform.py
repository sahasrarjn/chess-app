"""Legacy coordinate remap (unused).

Fairy-Stockfish chessborder accepts the same client-centered FEN/UCI as the web
and iOS apps (see ChessBorder/Resources/Engine/variants.ini). The server passes
client FEN through unchanged; do not call these helpers in the move pipeline.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

_SQUARE = re.compile(r"^([a-j])(10|[1-9])")

_CLIENT_TO_ENGINE_COL = tuple(
    json.loads(
        (
            Path(__file__).resolve().parent / "shared" / "engine-column-map.json"
            if (Path(__file__).resolve().parent / "shared" / "engine-column-map.json").is_file()
            else Path(__file__).resolve().parent.parent / "shared" / "engine-column-map.json"
        ).read_text(encoding="utf-8")
    )["clientColToEngineCol"]
)
_ENGINE_TO_CLIENT_COL = tuple(_CLIENT_TO_ENGINE_COL.index(c) for c in range(10))


def client_col_to_engine_col(client_col: int) -> int:
    return _CLIENT_TO_ENGINE_COL[client_col]


def engine_col_to_client_col(engine_col: int) -> int:
    return _ENGINE_TO_CLIENT_COL[engine_col]


@lru_cache(maxsize=256)
def _parse_square(square: str) -> tuple[int, int]:
    match = _SQUARE.match(square.strip().lower())
    if not match:
        raise ValueError(f"Invalid square: {square}")
    col = ord(match.group(1)) - ord("a")
    rank = int(match.group(2))
    return col, rank


def _format_square(col: int, rank: int) -> str:
    file_ch = chr(ord("a") + col)
    rank_text = "10" if rank == 10 else str(rank)
    return f"{file_ch}{rank_text}"


def client_square_to_engine_square(square: str) -> str:
    col, rank = _parse_square(square)
    return _format_square(client_col_to_engine_col(col), rank)


def engine_square_to_client_square(square: str) -> str:
    col, rank = _parse_square(square)
    return _format_square(engine_col_to_client_col(col), rank)


def client_fen_to_engine_fen(fen: str) -> str:
    raise NotImplementedError("Coordinate remap is disabled; pass client FEN to the engine")


def engine_uci_to_client_uci(uci: str) -> str:
    raise NotImplementedError("Coordinate remap is disabled; engine UCI is already client-native")
