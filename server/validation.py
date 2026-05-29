"""Input validation for the engine HTTP API."""

from __future__ import annotations

import re

# Fairy-Stockfish chessborder FEN: ten slash-separated ranks, then standard tail.
# Ranks may use run-length digits or literal dots (see variants.ini startFen).
_FEN_BOARD = r"^[\.1-9/prnbqkRNBQKPN]+(?:/[\.1-9/prnbqkRNBQKPN]+){9}"
_FEN_TAIL = r" [wb] (?:[KQkq-]+|-) (?:[a-j](?:10|[1-9])|-) \d+ \d+$"
FEN_PATTERN = re.compile(rf"{_FEN_BOARD}{_FEN_TAIL}")

MAX_FEN_LENGTH = 200


def validate_fen(fen: str) -> str:
    """Return a normalized FEN or raise ValueError."""
    if not isinstance(fen, str):
        raise ValueError("FEN must be a string")
    if len(fen) > MAX_FEN_LENGTH:
        raise ValueError("FEN too long")
    if any(ch in fen for ch in ("\n", "\r", "\0")):
        raise ValueError("Invalid FEN characters")
    normalized = " ".join(fen.split())
    if not FEN_PATTERN.fullmatch(normalized):
        raise ValueError("Invalid FEN format")
    return normalized
