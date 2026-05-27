#!/usr/bin/env python3
"""Persistent UCI session for Fairy-Stockfish (chessborder variant)."""

from __future__ import annotations

import subprocess
import threading
from pathlib import Path


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
        self._wait_for("uciok")
        self._send(f"setoption name VariantPath value {variants_ini}")
        self._send("setoption name UCI_Variant value chessborder")
        self._send("isready")
        self._wait_for("readyok")

    def best_move(self, fen: str, elo: int, movetime_ms: int) -> str:
        with self._lock:
            self._send("stop")
            self._send("setoption name UCI_LimitStrength value true")
            self._send(f"setoption name UCI_Elo value {elo}")
            self._send(f"position fen {fen}")
            self._send(f"go movetime {movetime_ms}")
            line = self._wait_for("bestmove")
            parts = line.split()
            if len(parts) < 2 or parts[0] != "bestmove" or parts[1] == "(none)":
                raise RuntimeError(f"Engine returned no move: {line}")
            return parts[1]

    def _send(self, command: str) -> None:
        assert self._proc.stdin
        self._proc.stdin.write(command + "\n")
        self._proc.stdin.flush()

    def _wait_for(self, token: str) -> str:
        assert self._proc.stdout
        while True:
            line = self._proc.stdout.readline()
            if not line:
                raise RuntimeError("Engine process exited")
            line = line.strip()
            if token in line:
                return line

    def close(self) -> None:
        try:
            self._send("quit")
        except Exception:
            pass
        self._proc.terminate()
