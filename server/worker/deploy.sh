#!/usr/bin/env bash
# Deploy Cloudflare Worker API proxy after AWS App Runner is live.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK_NAME="${STACK_NAME:-chess-border-engine}"
REGION="${AWS_REGION:-us-east-1}"
WORKER_DIR="${ROOT}/server/worker"
WRANGLER_TOML="${WORKER_DIR}/wrangler.toml"

ensure_rate_limit_kv() {
  if grep -q 'binding = "RATE_LIMIT"' "$WRANGLER_TOML"; then
    return
  fi

  echo "==> Creating Cloudflare KV namespace for rate limiting"
  cd "$WORKER_DIR"
  local id
  id="$(npx wrangler kv namespace list --json 2>/dev/null \
    | python3 -c "import json,sys; ns=[n for n in json.load(sys.stdin) if n.get('title')=='RATE_LIMIT']; print(ns[0]['id'] if ns else '')" \
    || true)"
  if [[ -z "$id" ]]; then
    id="$(npx wrangler kv namespace create RATE_LIMIT 2>&1 \
      | sed -n 's/.*id = "\([^"]*\)".*/\1/p' \
      | head -1)"
  fi
  if [[ -z "$id" ]]; then
    echo "FATAL: could not create or locate RATE_LIMIT KV namespace" >&2
    exit 1
  fi
  python3 - "$WRANGLER_TOML" "$id" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
block = f'\n[[kv_namespaces]]\nbinding = "RATE_LIMIT"\nid = "{sys.argv[2]}"\n'
path.write_text(path.read_text().rstrip() + block + "\n")
PY
}

ORIGIN="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" \
  --output text 2>/dev/null || true)"

if [[ -z "$ORIGIN" ]]; then
  echo "App Runner stack not found. Run ./server/aws/deploy.sh first." >&2
  exit 1
fi

echo "==> Engine origin: $ORIGIN"

cd "$WORKER_DIR"
npm install
ensure_rate_limit_kv

echo "$ORIGIN" | npx wrangler secret put ENGINE_ORIGIN

if [[ -z "${API_KEY:-}" ]]; then
  SERVICE_ARN="$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='ServiceArn'].OutputValue" \
    --output text 2>/dev/null || true)"
  if [[ -n "$SERVICE_ARN" ]]; then
    API_KEY="$(aws apprunner describe-service \
      --service-arn "$SERVICE_ARN" \
      --region "$REGION" \
      --output json 2>/dev/null | python3 -c "
import json, sys
raw = json.load(sys.stdin)['Service']['SourceConfiguration']['ImageRepository']['ImageConfiguration'].get('RuntimeEnvironmentVariables') or {}
if isinstance(raw, list):
    raw = {e['Name']: e['Value'] for e in raw if 'Name' in e}
v = (raw.get('API_KEY') or '').strip()
if v and v not in ('None', 'null') and len(v) >= 32:
    print(v)
" 2>/dev/null || true)"
  fi
fi

if [[ "${API_KEY:-}" == "None" || "${API_KEY:-}" == "null" || ${#API_KEY} -lt 32 ]]; then
  unset API_KEY
fi

if [[ -n "${API_KEY:-}" ]]; then
  echo "$API_KEY" | npx wrangler secret put API_KEY
  echo "==> Synced API_KEY secret from App Runner"
else
  echo "Warning: could not read API_KEY from App Runner; set API_KEY env var and re-run." >&2
fi

npm run deploy
echo ""
echo "API worker: https://chess-engine.sahasraranjan.workers.dev"
echo "Public site: https://borderchess.org (CloudFront → S3; /v1/move proxied to worker)"
