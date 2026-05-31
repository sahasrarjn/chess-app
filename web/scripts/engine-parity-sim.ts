#!/usr/bin/env tsx
/**
 * Stress-test bot move legality: corpus cases + random legal games.
 * With ENGINE_URL, plays positions against live /v1/move and requires HTTP 200.
 */
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ChessGame } from "../src/engine/chessGame";
import { fromFEN, matchEngineMove, toFEN } from "../src/engine/fen";
import { engineNotation } from "../src/engine/types";

const GAMES = parseInt(process.env.PARITY_SIM_GAMES ?? "12", 10);
const PLIES = parseInt(process.env.PARITY_SIM_PLIES ?? "40", 10);
const ENGINE_URL = process.env.ENGINE_URL?.replace(/\/$/, "");

function pick<T>(items: T[]): T {
  return items[randomInt(items.length)]!;
}

async function verifyServerMove(fen: string): Promise<string> {
  const res = await fetch(`${ENGINE_URL}/v1/move`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.API_KEY ? { "X-API-Key": process.env.API_KEY } : {}),
    },
    body: JSON.stringify({ fen, elo: 1200, movetime_ms: 80 }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`server HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(text) as { uci?: string };
  if (!data.uci) throw new Error("server returned no uci");
  return data.uci;
}

async function main(): Promise<void> {
  const corpusPath = resolve(import.meta.dirname, "../../shared/engine-fen-corpus.json");
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Array<{
    name: string;
    fen: string;
    uci: string;
    setup_uci?: string[];
  }>;

  let failures = 0;

  for (const testCase of corpus) {
    const game = fromFEN(testCase.fen);
    for (const setup of testCase.setup_uci ?? []) {
      const m = matchEngineMove(game, setup);
      if (!m || !game.applyMove(m)) {
        console.error(`FAIL corpus setup ${testCase.name}: ${setup}`);
        failures++;
      }
    }
    const move = matchEngineMove(game, testCase.uci);
    if (!move || !game.applyMove(move)) {
      console.error(`FAIL corpus ${testCase.name}: ${testCase.uci}`);
      failures++;
    }
  }

  for (let g = 0; g < GAMES; g++) {
    const game = new ChessGame();
    for (let ply = 0; ply < PLIES; ply++) {
      const fen = toFEN(game);
      const moves = game.legalMoves(game.activeColor);
      if (moves.length === 0) break;

      if (ENGINE_URL) {
        try {
          const serverUci = await verifyServerMove(fen);
          const replay = fromFEN(fen);
          const matched = matchEngineMove(replay, serverUci);
          if (!matched || !replay.applyMove(matched)) {
            console.error(`FAIL live server ply ${ply}: ${serverUci} illegal`);
            failures++;
          }
        } catch (err) {
          console.error(`FAIL live server ply ${ply}:`, err);
          failures++;
        }
      }

      for (const move of moves) {
        const uci = `${engineNotation(move.from)}${engineNotation(move.to)}`;
        const replay = fromFEN(fen);
        const matched = matchEngineMove(replay, uci);
        if (!matched || !replay.applyMove(matched)) {
          console.error(`FAIL local ply ${ply}: ${uci}`);
          failures++;
        }
      }

      if (!game.applyMove(pick(moves))) break;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} parity simulation failure(s)`);
    process.exit(1);
  }
  const mode = ENGINE_URL ? `live ${ENGINE_URL}` : "local-only";
  console.log(
    `Parity simulation passed (${mode}, ${GAMES} games × ${PLIES} plies, corpus ${corpus.length} cases).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
