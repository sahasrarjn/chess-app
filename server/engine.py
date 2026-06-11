#!/usr/bin/env python3
"""Persistent UCI session for Fairy-Stockfish (chessborder variant)."""

from __future__ import annotations

import subprocess
import threading
from pathlib import Path


def parse_analysis(lines: list[str]) -> dict:
    """Parse UCI ``info ... score ... pv ...`` output into an analysis dict.

    Scores are from the side-to-move's perspective (UCI native).  The last
    exact (non-bound) info line wins; ``bestmove (none)`` means a terminal
    position (no score, no pv).
    """
    score_cp: int | None = None
    mate_in: int | None = None
    pv: list[str] = []
    best: str | None = None
    for line in lines:
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "bestmove":
            best = parts[1] if len(parts) > 1 and parts[1] != "(none)" else None
            continue
        if parts[0] != "info" or "score" not in parts or "pv" not in parts:
            continue
        if "lowerbound" in parts or "upperbound" in parts:
            continue
        si = parts.index("score")
        kind, value = parts[si + 1], int(parts[si + 2])
        if kind == "cp":
            score_cp, mate_in = value, None
        elif kind == "mate":
            score_cp, mate_in = None, value
        else:
            continue
        pv = parts[parts.index("pv") + 1 :]
    if best is None:
        pv = []
    return {"score_cp": score_cp, "mate_in": mate_in, "best_move_uci": best, "pv": pv}


class UCIEngine:
    def __init__(self, binary: Path, variants_ini: Path) -> None:
        self._lock = threading.Lock()
        self._proc = subprocess.Popen(
            [str(binary)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert self._proc.stdin and self._proc.stdout
        self._send("uci")
        self._wait_for("uciok", timeout_sec=15.0)
        self._send(f"setoption name VariantPath value {variants_ini}")
        self._send("setoption name UCI_Variant value chessborder")
        self._send("isready")
        self._wait_for("readyok", timeout_sec=15.0)

    def ping(self) -> None:
        self._send("isready")
        self._wait_for("readyok", timeout_sec=10.0)

    def best_move(self, fen: str, elo: int, movetime_ms: int) -> str:
        with self._lock:
            self._send("stop")
            self._send("setoption name UCI_LimitStrength value true")
            self._send(f"setoption name UCI_Elo value {elo}")
            self._send(f"position fen {fen}")
            self._send(f"go movetime {movetime_ms}")
            timeout_sec = max(5.0, movetime_ms / 1000.0 + 10.0)
            line = self._wait_for("bestmove", timeout_sec=timeout_sec)
            parts = line.split()
            if len(parts) < 2 or parts[0] != "bestmove" or parts[1] == "(none)":
                raise RuntimeError(f"Engine returned no move: {line}")
            return parts[1]

    def _send(self, command: str) -> None:
        assert self._proc.stdin
        self._proc.stdin.write(command + "\n")
        self._proc.stdin.flush()

    def analyse(self, fen: str | None, moves: list[str] | None, movetime_ms: int) -> dict:
        """Run a full-strength engine search and return a parsed analysis dict.

        The score is from the side-to-move's perspective (UCI native).
        best_move() re-enables UCI_LimitStrength per call, so we always
        reset it here to false for analysis quality.
        """
        with self._lock:
            self._send("stop")
            # Full strength for analysis; best_move() re-enables limit strength per call.
            self._send("setoption name UCI_LimitStrength value false")
            position = f"position fen {fen}" if fen else "position startpos"
            if moves:
                position += " moves " + " ".join(moves)
            self._send(position)
            self._send(f"go movetime {movetime_ms}")
            timeout_sec = max(5.0, movetime_ms / 1000.0 + 10.0)
            lines = self._collect_until("bestmove", timeout_sec=timeout_sec)
            return parse_analysis(lines)

    def _wait_for(self, token: str, timeout_sec: float = 30.0) -> str:
        assert self._proc.stdout
        result: list[str] = []
        error: list[BaseException] = []

        def reader() -> None:
            try:
                while True:
                    line = self._proc.stdout.readline()
                    if not line:
                        error.append(RuntimeError("Engine process exited"))
                        return
                    line = line.strip()
                    if token in line:
                        result.append(line)
                        return
            except Exception as exc:
                error.append(exc)

        thread = threading.Thread(target=reader, daemon=True)
        thread.start()
        thread.join(timeout_sec)
        if error:
            raise error[0]
        if not result:
            raise RuntimeError(f"Engine timed out waiting for {token}")
        return result[0]

    def _collect_until(self, token: str, timeout_sec: float = 30.0) -> list[str]:
        """Read lines from the engine, collecting all of them, and stop once a
        line containing *token* has been read.  Returns every collected line
        including the line that matched.

        Same reader-thread / timeout / error structure as ``_wait_for``.
        """
        assert self._proc.stdout
        result: list[str] = []
        error: list[BaseException] = []

        def reader() -> None:
            try:
                while True:
                    line = self._proc.stdout.readline()
                    if not line:
                        error.append(RuntimeError("Engine process exited"))
                        return
                    line = line.strip()
                    result.append(line)
                    if token in line:
                        return
            except Exception as exc:
                error.append(exc)

        thread = threading.Thread(target=reader, daemon=True)
        thread.start()
        thread.join(timeout_sec)
        if error:
            raise error[0]
        if not result or token not in result[-1]:
            raise RuntimeError(f"Engine timed out waiting for {token}")
        return result

    def close(self) -> None:
        try:
            self._send("quit")
        except Exception:
            pass
        self._proc.terminate()
