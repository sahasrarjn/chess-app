#!/usr/bin/env tsx
/** CLI: exit 0 when UCI is legal for FEN under web/iOS rules (used in CI + server Docker). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fromFEN, matchEngineMove, toFEN } from "../src/engine/fen";

function usage(): never {
  console.error("Usage: validate-move-cli.ts <fen> <uci>");
  console.error("   or: validate-move-cli.ts --corpus <path-to-engine-fen-corpus.json> [--server <url>]");
  process.exit(2);
}

async function validateCorpus(corpusPath: string, serverUrl?: string): Promise<number> {
  const raw = readFileSync(corpusPath, "utf8");
  const cases = JSON.parse(raw) as Array<{
    name: string;
    fen: string;
    uci: string;
    setup_uci?: string[];
  }>;

  let failed = 0;
  for (const testCase of cases) {
    const game = fromFEN(testCase.fen);
    for (const setup of testCase.setup_uci ?? []) {
      const setupMove = matchEngineMove(game, setup);
      if (!setupMove || !game.applyMove(setupMove)) {
        console.error(`FAIL setup ${testCase.name}: ${setup}`);
        failed++;
        continue;
      }
    }

    const move = matchEngineMove(game, testCase.uci);
    if (!move || !game.applyMove(move)) {
      console.error(`FAIL ${testCase.name}: ${testCase.uci} not legal locally`);
      failed++;
      continue;
    }

    if (serverUrl) {
      const serverGame = fromFEN(testCase.fen);
      for (const setup of testCase.setup_uci ?? []) {
        const setupMove = matchEngineMove(serverGame, setup);
        if (!setupMove || !serverGame.applyMove(setupMove)) {
          console.error(`FAIL setup ${testCase.name}: ${setup}`);
          failed++;
          continue;
        }
      }
      const fenForServer = toFEN(serverGame);
      const res = await fetch(`${serverUrl.replace(/\/$/, "")}/v1/move`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.API_KEY ? { "X-API-Key": process.env.API_KEY } : {}),
        },
        body: JSON.stringify({ fen: fenForServer, elo: 1200, movetime_ms: 100 }),
      });
      if (!res.ok) {
        console.error(`FAIL ${testCase.name}: server HTTP ${res.status}`);
        failed++;
        continue;
      }
      const data = (await res.json()) as { uci?: string };
      if (!data.uci) {
        console.error(`FAIL ${testCase.name}: server returned no uci`);
        failed++;
        continue;
      }
      const serverMove = matchEngineMove(serverGame, data.uci);
      if (!serverMove) {
        console.error(`FAIL ${testCase.name}: server uci ${data.uci} not legal locally`);
        failed++;
        continue;
      }
    }

    console.log(`OK ${testCase.name}`);
  }
  return failed > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--corpus") {
    const corpusPath = resolve(args[1] ?? usage());
    const serverIdx = args.indexOf("--server");
    const serverUrl = serverIdx >= 0 ? args[serverIdx + 1] : undefined;
    process.exit(await validateCorpus(corpusPath, serverUrl));
  }

  const [fen, uci] = args;
  if (!fen || !uci) usage();

  const game = fromFEN(fen);
  const move = matchEngineMove(game, uci);
  if (!move || !game.applyMove(move)) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
