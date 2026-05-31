#!/usr/bin/env tsx
/**
 * Discover engine/client parity gaps: targeted border positions + deep random search.
 * Run with ENGINE_URL=http://localhost:8081 to probe live engine.
 * Exits non-zero on failures; prints JSON lines suitable for corpus expansion.
 */
import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ChessGame } from "../src/engine/chessGame";
import { fromFEN, matchEngineMove, toFEN } from "../src/engine/fen";
import { engineNotation } from "../src/engine/types";

const ENGINE_URL = process.env.ENGINE_URL?.replace(/\/$/, "");
const GAMES = parseInt(process.env.PROBE_GAMES ?? "40", 10);
const PLIES = parseInt(process.env.PROBE_PLIES ?? "60", 10);
const OUT = process.env.PROBE_OUT;

type Failure = {
  kind: string;
  fen: string;
  detail: string;
  uci?: string;
};

const failures: Failure[] = [];

function record(kind: string, fen: string, detail: string, uci?: string): void {
  failures.push({ kind, fen, detail, uci });
  console.error(`FAIL [${kind}] ${detail}${uci ? ` uci=${uci}` : ""}`);
}

async function serverMove(fen: string): Promise<{ ok: true; uci: string } | { ok: false; status: number; body: string }> {
  const res = await fetch(`${ENGINE_URL}/v1/move`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.API_KEY ? { "X-API-Key": process.env.API_KEY } : {}),
    },
    body: JSON.stringify({ fen, elo: 1200, movetime_ms: 100 }),
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body };
  const data = JSON.parse(body) as { uci?: string };
  if (!data.uci) return { ok: false, status: res.status, body: "no uci" };
  return { ok: true, uci: data.uci };
}

function probeFenRoundTrip(game: ChessGame): void {
  const fen = toFEN(game);
  const replay = fromFEN(fen);
  const fen2 = toFEN(replay);
  if (fen.split(" ")[0] !== fen2.split(" ")[0]) {
    record("fen_roundtrip", fen, `placement changed: ${fen.split(" ")[0]} -> ${fen2.split(" ")[0]}`);
  }
  const moves1 = game.legalMoves(game.activeColor).length;
  const moves2 = replay.legalMoves(replay.activeColor).length;
  if (moves1 !== moves2) {
    record("fen_roundtrip", fen, `legal move count ${moves1} -> ${moves2}`);
  }
}

function probeUciEngineNotation(game: ChessGame): void {
  for (const move of game.legalMoves(game.activeColor)) {
    const eng = `${engineNotation(move.from)}${engineNotation(move.to)}`;
    const fen = toFEN(game);
    const replay = fromFEN(fen);
    if (!matchEngineMove(replay, eng)) {
      record("uci_engine_notation", fen, `engine uci ${eng} not matched`);
    }
  }
}

/** Positions that historically broke coordinate transforms or border rules. */
function targetedPositions(): string[] {
  const out: string[] = [];
  const game = new ChessGame();

  // Play until we hit positions with border pieces or ep targets
  for (let ply = 0; ply < 80; ply++) {
    const fen = toFEN(game);
    const hasBorderPiece = game.board.some((row, r) =>
      row.some((p, c) => p && (r === 0 || r === 9 || c === 0 || c === 9))
    );
    if (game.enPassantTarget || hasBorderPiece) {
      out.push(fen);
    }
    const moves = game.legalMoves(game.activeColor);
    if (moves.length === 0) break;
    // bias toward pawn pushes and captures
    const preferred = moves.filter((m) => {
      const piece = game.board[m.from.row][m.from.col];
      return piece?.kind === "P" || m.to.col === 0 || m.to.col === 9 || m.to.row === 0 || m.to.row === 9;
    });
    const pick = (preferred.length ? preferred : moves)[randomInt(preferred.length || moves.length)]!;
    game.applyMove(pick);
  }
  return out;
}

async function probePosition(fen: string, kind: string): Promise<void> {
  const game = fromFEN(fen);
  probeFenRoundTrip(game);
  probeUciEngineNotation(game);

  if (!ENGINE_URL) return;

  const result = await serverMove(fen);
  if (!result.ok) {
    record("server_http", fen, `HTTP ${result.status}: ${result.body.slice(0, 120)}`);
    return;
  }
  const replay = fromFEN(fen);
  const matched = matchEngineMove(replay, result.uci);
  if (!matched || !replay.applyMove(matched)) {
    record(kind, fen, "server uci not legal locally", result.uci);
  }
}

async function main(): Promise<void> {
  if (!ENGINE_URL) {
    console.error("WARN: set ENGINE_URL to probe live engine (local FEN/UCI checks still run)");
  }

  for (const fen of targetedPositions()) {
    await probePosition(fen, "targeted");
  }

  for (let g = 0; g < GAMES; g++) {
    const game = new ChessGame();
    for (let ply = 0; ply < PLIES; ply++) {
      const fen = toFEN(game);
      await probePosition(fen, `random_g${g}_p${ply}`);
      const moves = game.legalMoves(game.activeColor);
      if (moves.length === 0) break;
      game.applyMove(moves[randomInt(moves.length)]!);
    }
  }

  if (OUT && failures.length) {
    writeFileSync(OUT, failures.map((f) => JSON.stringify(f)).join("\n") + "\n");
  }

  if (failures.length) {
    console.error(`\n${failures.length} probe failure(s)`);
    process.exit(1);
  }
  console.log(`Probe passed (${GAMES} random games × ${PLIES} plies, ENGINE_URL=${ENGINE_URL ?? "none"}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
