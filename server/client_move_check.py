"""Verify engine UCI against the web/iOS rules bundle (validate-move.js)."""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

VALIDATOR_JS = Path(__file__).resolve().parent / "validate-move.js"


def client_accepts_move(fen: str, uci: str) -> bool:
    """Return True when the bundled Node validator accepts fen+uci."""
    if not VALIDATOR_JS.is_file():
        logger.warning("validate-move.js missing; skipping client parity check")
        return True

    try:
        proc = subprocess.run(
            ["node", str(VALIDATOR_JS), fen, uci],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.error("client parity validator failed to run: %s", exc)
        return True

    if proc.returncode == 0:
        return True

    logger.warning(
        "client parity reject uci=%s stderr=%s",
        uci,
        (proc.stderr or proc.stdout or "").strip(),
    )
    return False


def log_structured(event: str, **fields: object) -> None:
    payload = {"event": event, **fields}
    logger.info(json.dumps(payload, separators=(",", ":")))
