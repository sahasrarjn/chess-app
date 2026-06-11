from __future__ import annotations

import hashlib
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import re
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from client_move_check import client_accepts_move, log_structured
from engine_manager import EngineManager
from validation import validate_fen

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

ENGINE_BIN = Path(os.environ.get("ENGINE_BIN", "/usr/local/bin/fairy-stockfish"))
VARIANTS_INI = Path(os.environ.get("VARIANTS_INI", "/app/variants.ini"))
API_KEY = os.environ.get("API_KEY", "")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", "4096"))
CLIENT_PARITY_CHECK = os.environ.get("CLIENT_PARITY_CHECK", "1") != "0"
MAX_PARITY_RETRIES = int(os.environ.get("MAX_PARITY_RETRIES", "4"))
UCI_MOVE_RE = re.compile(r"^[a-j](?:10|[1-9])[a-j](?:10|[1-9])[qrbn]?$")
ANALYZE_MAX_BODY_BYTES = int(os.environ.get("ANALYZE_MAX_BODY_BYTES", "16384"))
ANALYZE_MAX_MOVETIME_MS = 1000

engine: EngineManager | None = None


def fen_fingerprint(fen: str) -> str:
    return hashlib.sha256(fen.encode("utf-8")).hexdigest()[:16]


@asynccontextmanager
async def lifespan(_: FastAPI):
    global engine
    if not ENGINE_BIN.is_file():
        raise RuntimeError(f"Engine binary not found: {ENGINE_BIN}")
    if not VARIANTS_INI.is_file():
        raise RuntimeError(f"variants.ini not found: {VARIANTS_INI}")
    if not API_KEY:
        logger.warning("API_KEY is not set; engine API is open to anyone who can reach this host")
    engine = EngineManager(ENGINE_BIN, VARIANTS_INI)
    yield
    if engine:
        engine.close()


app = FastAPI(title="Border Chess Engine", version="1.0.0", lifespan=lifespan)

if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-API-Key"],
    )


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    if request.method == "POST" and request.url.path in ("/v1/move", "/v1/analyze"):
        limit = MAX_BODY_BYTES if request.url.path == "/v1/move" else ANALYZE_MAX_BODY_BYTES
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > limit:
            return JSONResponse(status_code=413, content={"detail": "Request body too large"})
    return await call_next(request)


class MoveRequest(BaseModel):
    fen: str = Field(..., min_length=10, max_length=200)
    elo: int = Field(1400, ge=800, le=3200)
    movetime_ms: int = Field(500, ge=50, le=30_000)

    @field_validator("fen")
    @classmethod
    def check_fen(cls, value: str) -> str:
        try:
            return validate_fen(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc


class MoveResponse(BaseModel):
    uci: str


class AnalyzeRequest(BaseModel):
    fen: Optional[str] = Field(None, min_length=10, max_length=200)
    moves: Optional[List[str]] = Field(None, max_length=1024)
    movetime_ms: int = Field(200, ge=50, le=ANALYZE_MAX_MOVETIME_MS)

    @field_validator("fen")
    @classmethod
    def check_fen(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        try:
            return validate_fen(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("moves")
    @classmethod
    def check_moves(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return None
        for move in value:
            if not UCI_MOVE_RE.fullmatch(move):
                raise ValueError(f"Invalid UCI move: {move!r}")
        return value

    @model_validator(mode="after")
    def check_position(self) -> "AnalyzeRequest":
        if self.fen is None and self.moves is None:
            raise ValueError("fen or moves is required")
        return self


class AnalyzeResponse(BaseModel):
    score_cp: Optional[int]
    mate_in: Optional[int]
    best_move_uci: Optional[str]
    pv: List[str]


def require_api_key(x_api_key: str | None) -> None:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/health")
def health():
    # Avoid UCI ping on every probe (App Runner hits this often; ping holds the engine lock).
    ready = engine is not None
    payload = {
        "status": "ok" if ready else "degraded",
        "engine_ready": ready,
        "engine": "fairy-stockfish",
        "variant": "chessborder",
    }
    if not ready:
        return JSONResponse(status_code=503, content=payload)
    return payload


@app.post("/v1/move", response_model=MoveResponse)
def move(
    req: MoveRequest,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> MoveResponse:
    require_api_key(x_api_key)

    if engine is None:
        raise HTTPException(status_code=503, detail="Engine not ready")

    fen_hash = fen_fingerprint(req.fen)
    started = time.monotonic()
    try:
        # Fairy-Stockfish chessborder uses the same client-centered FEN/UCI as the
        # apps (see variants.ini startFen). Do not remap coordinates.
        last_uci = ""
        for attempt in range(MAX_PARITY_RETRIES):
            movetime_ms = req.movetime_ms + attempt * 50
            uci = engine.best_move(req.fen, req.elo, movetime_ms)
            last_uci = uci
            if not CLIENT_PARITY_CHECK or client_accepts_move(req.fen, uci):
                elapsed_ms = int((time.monotonic() - started) * 1000)
                log_structured(
                    "move_ok",
                    uci=uci,
                    fen_hash=fen_hash,
                    movetime_ms=movetime_ms,
                    elapsed_ms=elapsed_ms,
                    elo=req.elo,
                    attempt=attempt + 1,
                )
                return MoveResponse(uci=uci)

        elapsed_ms = int((time.monotonic() - started) * 1000)
        log_structured(
            "move_reject_client_parity",
            uci=last_uci,
            fen_hash=fen_hash,
            movetime_ms=req.movetime_ms,
            elapsed_ms=elapsed_ms,
            elo=req.elo,
            attempts=MAX_PARITY_RETRIES,
        )
        raise HTTPException(
            status_code=422,
            detail=f"Engine move ({last_uci}) failed client rules validation",
        )
    except HTTPException:
        raise
    except ValueError as exc:
        log_structured("move_bad_request", fen_hash=fen_hash, error=str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError:
        log_structured("move_engine_unavailable", fen_hash=fen_hash)
        logger.exception("Engine move failed after restart")
        raise HTTPException(status_code=503, detail="Engine unavailable") from None
    except Exception:
        log_structured("move_engine_error", fen_hash=fen_hash)
        logger.exception("Unexpected engine failure")
        raise HTTPException(status_code=500, detail="Engine error") from None


@app.post("/v1/analyze", response_model=AnalyzeResponse)
def analyze(
    req: AnalyzeRequest,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> AnalyzeResponse:
    require_api_key(x_api_key)
    if engine is None:
        raise HTTPException(status_code=503, detail="Engine not ready")

    fen_hash = fen_fingerprint(req.fen or " ".join(req.moves or []))
    started = time.monotonic()
    try:
        data = engine.analyse(req.fen, req.moves, req.movetime_ms)
        best = data["best_move_uci"]
        # Same client-parity guard as /v1/move, but advisory: a rejected best
        # move nulls the suggestion and keeps the score (a review must not 422).
        if best and CLIENT_PARITY_CHECK and req.fen and not req.moves:
            if not client_accepts_move(req.fen, best):
                log_structured("analyze_reject_client_parity", uci=best, fen_hash=fen_hash)
                data["best_move_uci"] = None
                data["pv"] = []
        elapsed_ms = int((time.monotonic() - started) * 1000)
        log_structured(
            "analyze_ok",
            fen_hash=fen_hash,
            movetime_ms=req.movetime_ms,
            elapsed_ms=elapsed_ms,
            score_cp=data["score_cp"],
            mate_in=data["mate_in"],
        )
        return AnalyzeResponse(**data)
    except HTTPException:
        raise
    except ValueError as exc:
        log_structured("analyze_bad_request", fen_hash=fen_hash, error=str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError:
        log_structured("analyze_engine_unavailable", fen_hash=fen_hash)
        logger.exception("Engine analyse failed after restart")
        raise HTTPException(status_code=503, detail="Engine unavailable") from None
    except Exception:
        log_structured("analyze_engine_error", fen_hash=fen_hash)
        logger.exception("Unexpected engine failure")
        raise HTTPException(status_code=500, detail="Engine error") from None
