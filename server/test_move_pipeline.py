"""Guardrails for the engine move pipeline."""

from __future__ import annotations

import unittest
from pathlib import Path


class MovePipelineGuardTests(unittest.TestCase):
    def test_main_does_not_remap_coordinates(self) -> None:
        main_py = (Path(__file__).resolve().parent / "main.py").read_text(encoding="utf-8")
        self.assertNotIn("fen_transform", main_py)
        self.assertNotIn("client_fen_to_engine_fen", main_py)
        self.assertNotIn("engine_uci_to_client_uci", main_py)
        self.assertIn("Do not remap coordinates", main_py)

    def test_variants_ini_uses_client_start_fen(self) -> None:
        variants = (
            Path(__file__).resolve().parent.parent
            / "ChessBorder/ChessBorder/Resources/Engine/variants.ini"
        ).read_text(encoding="utf-8")
        self.assertIn(".rnbqkbnr.", variants)
        self.assertIn("startFen", variants)


if __name__ == "__main__":
    unittest.main()
