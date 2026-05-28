"""Thread-safe Fairy-Stockfish process with automatic restart."""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from engine import UCIEngine

logger = logging.getLogger(__name__)


class EngineManager:
    def __init__(self, binary: Path, variants_ini: Path) -> None:
        self._binary = binary
        self._variants_ini = variants_ini
        self._lock = threading.Lock()
        self._engine: UCIEngine | None = None
        self._start()

    def _start(self) -> None:
        if self._engine is not None:
            try:
                self._engine.close()
            except Exception:
                logger.exception("Failed to close stale engine process")
        self._engine = UCIEngine(self._binary, self._variants_ini)

    def best_move(self, fen: str, elo: int, movetime_ms: int) -> str:
        with self._lock:
            try:
                assert self._engine is not None
                return self._engine.best_move(fen, elo, movetime_ms)
            except RuntimeError:
                logger.warning("Engine failed during move; restarting process")
                self._start()
                assert self._engine is not None
                return self._engine.best_move(fen, elo, movetime_ms)

    def is_ready(self) -> bool:
        with self._lock:
            if self._engine is None:
                return False
            try:
                self._engine.ping()
                return True
            except RuntimeError:
                logger.warning("Engine health check failed; restarting process")
                try:
                    self._start()
                    assert self._engine is not None
                    self._engine.ping()
                    return True
                except RuntimeError:
                    return False

    def close(self) -> None:
        with self._lock:
            if self._engine is not None:
                self._engine.close()
                self._engine = None
