#!/usr/bin/env bash
# Smoke-test borderchess.org (or BASE_URL) after deploy.
set -euo pipefail

BASE="${BASE_URL:-https://borderchess.org}"
BASE="${BASE%/}"
CURL="${CURL:-curl}"
FAIL=0

# 10×10 chessborder starting FEN (matches server/test_validation.py)
START_FEN='........../.rnbqkbnr./.pppppppp./......../......../......../......../.PPPPPPPP./.RNBQKBNR./.......... w KQkq - 0 1'

check() {
  local label="$1" url="$2" expect="${3:-200}"
  local code
  code="$("$CURL" -s -o /dev/null -w "%{http_code}" "$url" || echo "000")"
  if [[ "$code" == "$expect" ]]; then
    echo "OK   $label ($code)"
  else
    echo "FAIL $label (got $code, want $expect) — $url"
    FAIL=1
  fi
}

echo "==> Static assets ($BASE)"
check "landing"        "$BASE/"
check "game"           "$BASE/play/"
check "privacy"        "$BASE/privacy/"
check "logo"           "$BASE/logo.png"
check "piece (CDN path)" "$BASE/ChessBorder/pieces/wP.svg"
check "piece (legacy)"   "$BASE/play/pieces/wP.svg"

echo ""
echo "==> API"
check "health" "$BASE/health"

echo -n "     bot move … "
MOVE_RESP="$("$CURL" -s -X POST "$BASE/v1/move" \
  -H "Content-Type: application/json" \
  -d "{\"fen\":\"${START_FEN}\",\"elo\":1200,\"movetime_ms\":500}")"
if echo "$MOVE_RESP" | grep -q '"uci"'; then
  echo "OK   ($(echo "$MOVE_RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("uci",""))' 2>/dev/null || echo uci))"
else
  echo "FAIL — $MOVE_RESP"
  FAIL=1
fi

echo -n "     junk FEN skips rate limit … "
JUNK_RESP="$("$CURL" -s -X POST "$BASE/v1/move" \
  -H "Content-Type: application/json" \
  -d '{"fen":"invalid"}')"
if echo "$JUNK_RESP" | grep -q 'Invalid FEN'; then
  echo "OK"
else
  echo "FAIL — $JUNK_RESP"
  FAIL=1
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "All checks passed."
  exit 0
fi
echo "Some checks failed."
exit 1
