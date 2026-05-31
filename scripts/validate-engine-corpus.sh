#!/usr/bin/env bash
# Validate shared FEN corpus against local rules and optionally a live engine URL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORPUS="${ROOT}/shared/engine-fen-corpus.json"
WEB="${ROOT}/web"

echo "==> Local rules (web engine)"
cd "$WEB"
npx tsx scripts/validate-move-cli.ts --corpus "$CORPUS"

if [[ -n "${ENGINE_URL:-}" ]]; then
  echo ""
  echo "==> Server parity (${ENGINE_URL})"
  npx tsx scripts/validate-move-cli.ts --corpus "$CORPUS" --server "$ENGINE_URL"
fi

echo ""
echo "Corpus validation passed."
