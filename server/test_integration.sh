#!/usr/bin/env bash
# Integration smoke test for the engine API (run against docker compose or App Runner).
set -euo pipefail

BASE_URL="${1:-http://localhost:8081}"
API_KEY="${API_KEY:-}"
START_FEN='........../.rnbqkbnr./.pppppppp./......../......../......../......../.PPPPPPPP./.RNBQKBNR./.......... w KQkq - 0 1'

curl_auth() {
  if [[ -n "$API_KEY" ]]; then
    curl -sS -H "X-API-Key: $API_KEY" "$@"
  else
    curl -sS "$@"
  fi
}

echo "==> Health: $BASE_URL/health"
health_code="$(curl_auth -o /tmp/chess-health.json -w '%{http_code}' "$BASE_URL/health")"
cat /tmp/chess-health.json
echo ""
if [[ "$health_code" != "200" ]]; then
  echo "FATAL: expected health 200, got $health_code" >&2
  exit 1
fi

echo "==> Move: $BASE_URL/v1/move"
move_code="$(curl_auth -o /tmp/chess-move.json -w '%{http_code}' \
  -X POST "$BASE_URL/v1/move" \
  -H 'Content-Type: application/json' \
  -d "{\"fen\":\"$START_FEN\",\"elo\":800,\"movetime_ms\":50}")"
cat /tmp/chess-move.json
echo ""
if [[ "$move_code" != "200" ]]; then
  echo "FATAL: expected move 200, got $move_code" >&2
  exit 1
fi

echo "==> Reject invalid FEN"
reject_code="$(curl_auth -o /tmp/chess-bad.json -w '%{http_code}' \
  -X POST "$BASE_URL/v1/move" \
  -H 'Content-Type: application/json' \
  -d '{"fen":"bad","elo":800,"movetime_ms":50}')"
if [[ "$reject_code" != "422" && "$reject_code" != "400" ]]; then
  echo "FATAL: expected invalid FEN 400/422, got $reject_code" >&2
  cat /tmp/chess-bad.json
  exit 1
fi

echo "==> Integration test passed"
