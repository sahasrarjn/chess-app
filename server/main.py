#!/usr/bin/env python3
"""HTTP API for Chess Border — Fairy-Stockfish on the server."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from engine import UCIEngine

ENGINE_BIN = Path(os.environ.get("ENGINE_BIN", "/usr/local/bin/fairy-stockfish"))
VARIANTS_INI = Path(os.environ.get("VARIANTS_INI", "/app/variants.ini"))
API_KEY = os.environ.get("API_KEY", "")

engine: UCIEngine | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global engine
    if not ENGINE_BIN.is_file():
        raise RuntimeError(f"Engine binary not found: {ENGINE_BIN}")
    if not VARIANTS_INI.is_file():
        raise RuntimeError(f"variants.ini not found: {VARIANTS_INI}")
    engine = UCIEngine(ENGINE_BIN, VARIANTS_INI)
    yield
    if engine:
        engine.close()


app = FastAPI(title="Chess Border Engine", version="1.0.0", lifespan=lifespan)


class MoveRequest(BaseModel):
    fen: str = Field(..., min_length=10)
    elo: int = Field(1600, ge=800, le=3200)
    movetime_ms: int = Field(500, ge=50, le=30_000)


class MoveResponse(BaseModel):
    uci: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "fairy-stockfish", "variant": "chessborder"}


@app.post("/v1/move", response_model=MoveResponse)
def move(
    req: MoveRequest,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> MoveResponse:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if engine is None:
        raise HTTPException(status_code=503, detail="Engine not ready")
    try:
        uci = engine.best_move(req.fen, req.elo, req.movetime_ms)
        return MoveResponse(uci=uci)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
