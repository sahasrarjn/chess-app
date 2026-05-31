"""Map between client-centered FEN/UCI and Fairy-Stockfish left-aligned coordinates.

The web/iOS apps keep the inner 8×8 on board columns 1–8 with a border ring on
all sides. Fairy-Stockfish places the same pieces on files a–h (columns 0–7) with
only a right-hand border (files i–j). Each rank string is shifted one file left
when talking to the engine, and engine UCI is shifted one file right for clients.
"""

from __future__ import annotations

import re

_SQUARE = re.compile(r"^([a-j])(10|[1-9])")


def _shift_square(square: str, delta: int) -> str:
    match = _SQUARE.match(square)
    if not match:
        return square
    file_ch = match.group(1)
    rank = match.group(2)
    new_ord = ord(file_ch) + delta
    if new_ord < ord("a") or new_ord > ord("j"):
        return square
    return f"{chr(new_ord)}{rank}"


def _shift_uci_files(uci: str, delta: int) -> str:
    trimmed = uci.strip().lower()
    promo = ""
    if len(trimmed) > 4 and trimmed[4] in "qrbn":
        promo = trimmed[4]
        trimmed = trimmed[:4]
    if len(trimmed) < 4:
        return uci

    from_sq = trimmed[:2]
    if trimmed[1:3] == "10":
        from_sq = trimmed[:3]
        to_start = 3
    else:
        to_start = 2
    to_sq = trimmed[to_start : to_start + 2]
    if trimmed[to_start + 1 : to_start + 3] == "10":
        to_sq = trimmed[to_start : to_start + 3]

    return _shift_square(from_sq, delta) + _shift_square(to_sq, delta) + promo


def _normalize_client_rank(rank: str) -> str:
    if len(rank) == 10:
        return rank
    if len(rank) == 8:
        return rank + ".."
    raise ValueError("Each FEN rank must be 8 or 10 characters")


def _shift_rank_client_to_engine(rank: str) -> str:
    rank = _normalize_client_rank(rank)
    if all(ch == "." for ch in rank):
        return ".........."
    out = ["."] * 10
    for client_col in range(1, 9):
        out[client_col - 1] = rank[client_col]
    out[8] = rank[9]
    return "".join(out)


def _shift_rank_engine_to_client(rank: str) -> str:
    if len(rank) != 10:
        raise ValueError("Each FEN rank must be 10 characters")
    out = ["." ] * 10
    for engine_col in range(8):
        out[engine_col + 1] = rank[engine_col]
    out[9] = rank[8]
    return "".join(out)


def client_fen_to_engine_fen(fen: str) -> str:
    """Convert client-centered FEN to Fairy-Stockfish coordinates."""
    parts = fen.split()
    if len(parts) < 4:
        raise ValueError("Invalid FEN")
    ranks = parts[0].split("/")
    if len(ranks) != 10:
        raise ValueError("Invalid FEN board")
    engine_ranks = [_shift_rank_client_to_engine(rank) for rank in ranks]
    ep = parts[3]
    if ep != "-":
        ep = _shift_square(ep, -1)
    parts[0] = "/".join(engine_ranks)
    parts[3] = ep
    return " ".join(parts)


def engine_uci_to_client_uci(uci: str) -> str:
    """Convert Fairy-Stockfish UCI to client-centered coordinates."""
    return _shift_uci_files(uci, 1)
