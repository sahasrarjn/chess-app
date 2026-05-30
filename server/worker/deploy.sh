#!/usr/bin/env bash
# Deploy Cloudflare Worker API proxy after AWS App Runner is live.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK_NAME="${STACK_NAME:-chess-border-engine}"
REGION="${AWS_REGION:-us-east-1}"
WORKER_DIR="${ROOT}/server/worker"

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
