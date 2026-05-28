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

    def close(self) -> None:
        try:
            self._send("quit")
        except Exception:
            pass
        self._proc.terminate()
