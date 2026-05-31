#!/usr/bin/env bash
# Validate shared FEN corpus against local rules and optionally a live engine URL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORPUS="${ROOT}/shared/engine-fen-corpus.json"
REGRESSION_FENS="${ROOT}/shared/posthog-regression-fens.json"
WEB="${ROOT}/web"

echo "==> Local rules (web engine)"
cd "$WEB"
npx tsx scripts/validate-move-cli.ts --corpus "$CORPUS"
npm run test:parity-sim

if [[ -n "${ENGINE_URL:-}" ]]; then
  echo ""
  echo "==> Server parity (${ENGINE_URL})"
  npx tsx scripts/validate-move-cli.ts --corpus "$CORPUS" --server "$ENGINE_URL"
  echo ""
  echo "==> PostHog regression FENs (engine must return legal move)"
  npx tsx scripts/validate-move-cli.ts --regression-fens "$REGRESSION_FENS" --server "$ENGINE_URL"
fi

echo ""
echo "Corpus validation passed."
