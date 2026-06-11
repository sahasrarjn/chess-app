"""Tests for UCI analysis parsing and AnalyzeRequest/AnalyzeResponse models."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# Make sure server/ is on the path (matches the existing test discovery pattern).
_SERVER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SERVER_DIR))

from engine import parse_analysis

START_FEN = (
    "........../.rnbqkbnr./.pppppppp./......../......../"
    "......../......../.PPPPPPPP./.RNBQKBNR./.......... w KQkq - 0 1"
)

# ---------------------------------------------------------------------------
# Task 3: parse_analysis unit tests
# ---------------------------------------------------------------------------


class ParseAnalysisTests(unittest.TestCase):
    def test_cp_line(self) -> None:
        lines = [
            "info depth 12 seldepth 18 multipv 1 score cp 35 nodes 100 pv e2e4 e7e5",
            "bestmove e2e4 ponder e7e5",
        ]
        result = parse_analysis(lines)
        self.assertEqual(result["score_cp"], 35)
        self.assertIsNone(result["mate_in"])
        self.assertEqual(result["best_move_uci"], "e2e4")
        self.assertEqual(result["pv"], ["e2e4", "e7e5"])

    def test_mate_line(self) -> None:
        lines = [
            "info depth 5 score mate 3 nodes 50 pv d1h5 g8h6 h5f7",
            "bestmove d1h5",
        ]
        result = parse_analysis(lines)
        self.assertIsNone(result["score_cp"])
        self.assertEqual(result["mate_in"], 3)
        self.assertEqual(result["best_move_uci"], "d1h5")
        self.assertEqual(len(result["pv"]), 3)
        self.assertEqual(result["pv"][0], "d1h5")

    def test_negative_mate(self) -> None:
        lines = [
            "info depth 4 score mate -2 nodes 30 pv e7e8 d1h5",
            "bestmove e7e8",
        ]
        result = parse_analysis(lines)
        self.assertEqual(result["mate_in"], -2)
        self.assertIsNone(result["score_cp"])

    def test_last_info_wins(self) -> None:
        lines = [
            "info depth 1 score cp 10 nodes 10 pv e2e4",
            "info depth 5 score cp 80 nodes 500 pv d2d4",
            "bestmove d2d4",
        ]
        result = parse_analysis(lines)
        self.assertEqual(result["score_cp"], 80)
        self.assertEqual(result["pv"], ["d2d4"])

    def test_lowerbound_upperbound_skipped(self) -> None:
        lines = [
            "info depth 5 score cp 50 nodes 100 pv e2e4",
            "info depth 6 score cp 200 lowerbound nodes 200",
            "info depth 6 score cp 90 upperbound nodes 200",
            "bestmove e2e4",
        ]
        result = parse_analysis(lines)
        # The lowerbound/upperbound lines must not override the last exact line.
        self.assertEqual(result["score_cp"], 50)

    def test_bestmove_none(self) -> None:
        lines = ["bestmove (none)"]
        result = parse_analysis(lines)
        self.assertIsNone(result["best_move_uci"])
        self.assertEqual(result["pv"], [])
        self.assertIsNone(result["score_cp"])
        self.assertIsNone(result["mate_in"])

    def test_info_without_pv_ignored(self) -> None:
        lines = [
            "info string this is a string message no pv here",
            "info depth 1 score cp 5",
            "bestmove e2e4",
        ]
        # Should not raise; result relies only on lines with a pv token.
        result = parse_analysis(lines)
        # No valid info line parsed (no pv), so scores remain None; bestmove is set.
        self.assertIsNone(result["score_cp"])
        self.assertEqual(result["best_move_uci"], "e2e4")
        self.assertEqual(result["pv"], [])

    def test_border_moves_pass_through(self) -> None:
        lines = [
            "info depth 3 score cp 10 nodes 20 pv e4f10 j10i9 c1c10",
            "bestmove e4f10",
        ]
        result = parse_analysis(lines)
        self.assertEqual(result["best_move_uci"], "e4f10")
        self.assertEqual(result["pv"], ["e4f10", "j10i9", "c1c10"])


# ---------------------------------------------------------------------------
# Task 4: AnalyzeRequest / AnalyzeResponse model tests
# Import the models by loading them from main.py source via exec() to avoid
# triggering FastAPI route-decorator evaluation on Python 3.9 (which cannot
# resolve `str | None` union syntax at runtime even with the __future__ import).
# ---------------------------------------------------------------------------


def _load_models():
    """Load only the Pydantic models from main.py without registering FastAPI routes."""
    # Read the model definitions directly from main.py source.
    src = (_SERVER_DIR / "main.py").read_text(encoding="utf-8")

    lines = src.splitlines()
    in_model = False
    collected: list[str] = []
    # Pull in the constants and class definitions we need.
    for line in lines:
        stripped = line.rstrip()
        # Collect UCI_MOVE_RE, ANALYZE_MAX_BODY_BYTES, ANALYZE_MAX_MOVETIME_MS constants.
        if stripped.startswith("UCI_MOVE_RE") or \
           stripped.startswith("ANALYZE_MAX_BODY_BYTES") or \
           stripped.startswith("ANALYZE_MAX_MOVETIME_MS"):
            collected.append(stripped)
        # Collect full class blocks for AnalyzeRequest and AnalyzeResponse.
        elif stripped.startswith("class AnalyzeRequest") or stripped.startswith("class AnalyzeResponse"):
            in_model = True
            collected.append(stripped)
        elif in_model:
            # Stop at the next top-level definition (class or def or @decorator at col 0)
            if stripped and not line[0].isspace() and not stripped.startswith("#"):
                in_model = False
            else:
                collected.append(stripped)

    exec_src = (
        "from __future__ import annotations\n"
        "import os\n"
        "import re\n"
        "from typing import List, Optional\n"
        "from pydantic import BaseModel, Field, field_validator, model_validator\n"
        "from validation import validate_fen\n"
    ) + "\n".join(collected)

    ns: dict = {}
    exec(compile(exec_src, "<models>", "exec"), ns)
    # After exec() with `from __future__ import annotations`, Pydantic stores
    # annotations as strings and defers evaluation.  Rebuild with the exec
    # namespace so Optional/List/etc. resolve correctly on Python 3.9.
    ns["AnalyzeRequest"].model_rebuild(_types_namespace=ns)
    ns["AnalyzeResponse"].model_rebuild(_types_namespace=ns)
    return ns["AnalyzeRequest"], ns["AnalyzeResponse"]


class AnalyzeModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.AnalyzeRequest, cls.AnalyzeResponse = _load_models()

    def test_request_fen_only_valid(self) -> None:
        req = self.AnalyzeRequest(fen=START_FEN)
        self.assertEqual(req.movetime_ms, 200)
        self.assertIsNone(req.moves)

    def test_request_moves_only_valid(self) -> None:
        req = self.AnalyzeRequest(moves=["e2e4", "e7e5"])
        self.assertIsNone(req.fen)
        self.assertEqual(req.moves, ["e2e4", "e7e5"])

    def test_request_border_move_valid(self) -> None:
        req = self.AnalyzeRequest(moves=["e4f10"])
        self.assertEqual(req.moves, ["e4f10"])

    def test_request_neither_fen_nor_moves_invalid(self) -> None:
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            self.AnalyzeRequest()

    def test_request_bad_move_token(self) -> None:
        from pydantic import ValidationError
        for bad in ("zz99", "e2e4qq", "e2 e4"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValidationError):
                    self.AnalyzeRequest(moves=[bad])

    def test_request_too_many_moves(self) -> None:
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            self.AnalyzeRequest(moves=["e2e4"] * 1025)

    def test_request_movetime_too_low(self) -> None:
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            self.AnalyzeRequest(fen=START_FEN, movetime_ms=49)

    def test_request_movetime_too_high(self) -> None:
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            self.AnalyzeRequest(fen=START_FEN, movetime_ms=1001)

    def test_request_invalid_fen(self) -> None:
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            self.AnalyzeRequest(fen="startpos\nquit")
        with self.assertRaises(ValidationError):
            # too short (min_length=10)
            self.AnalyzeRequest(fen="short")

    def test_response_round_trip(self) -> None:
        resp = self.AnalyzeResponse(
            score_cp=None, mate_in=2, best_move_uci="d1h5", pv=["d1h5"]
        )
        self.assertIsNone(resp.score_cp)
        self.assertEqual(resp.mate_in, 2)
        self.assertEqual(resp.best_move_uci, "d1h5")

    def test_response_all_null_terminal(self) -> None:
        resp = self.AnalyzeResponse(
            score_cp=None, mate_in=None, best_move_uci=None, pv=[]
        )
        self.assertIsNone(resp.score_cp)
        self.assertIsNone(resp.best_move_uci)
        self.assertEqual(resp.pv, [])

    def test_source_guard_analyze_in_middleware(self) -> None:
        main_src = (_SERVER_DIR / "main.py").read_text()
        self.assertIn("/v1/analyze", main_src)
        # The body-limit middleware must cover /v1/analyze.
        self.assertIn('"/v1/analyze"', main_src)

    def test_source_guard_no_fen_transform(self) -> None:
        main_src = (_SERVER_DIR / "main.py").read_text()
        self.assertNotIn("fen_transform", main_src)


if __name__ == "__main__":
    unittest.main()
