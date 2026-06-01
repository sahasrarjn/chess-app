#!/usr/bin/env python3
"""Verify Fairy-Stockfish returns client-native UCI for client FEN (no coordinate remap)."""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

VALIDATOR = Path(__file__).resolve().parent / "validate-move.js"

CORPUS_FENS = [
    (
        "c9a10 left border bishop",
        "1R8/2nbqkb3/1pppppppp1/........../........../7n2/8P1/1PPPPPPP2/1RNBQKBN2/.......... b Q - 0 5",
        "c9a10",
    ),
]


def accepts_move(fen: str, uci: str) -> bool:
    if not VALIDATOR.is_file():
        raise unittest.SkipTest("validate-move.js not built")
    proc = subprocess.run(
        ["node", str(VALIDATOR), fen, uci],
        capture_output=True,
        text=True,
        timeout=8,
        check=False,
    )
    return proc.returncode == 0


class EngineNativeCoordinateTests(unittest.TestCase):
    def test_corpus_moves_validate(self) -> None:
        for name, fen, uci in CORPUS_FENS:
            with self.subTest(name=name):
                self.assertTrue(accepts_move(fen, uci), msg=uci)


if __name__ == "__main__":
    unittest.main()
