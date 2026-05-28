#!/usr/bin/env bash
# Deploy Cloudflare Worker proxy after AWS App Runner is live.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK_NAME="${STACK_NAME:-chess-border-engine}"
REGION="${AWS_REGION:-us-east-1}"

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
cd "${ROOT}/server/worker"
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
      --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.API_KEY' \
      --output text 2>/dev/null || true)"
  fi
fi

if [[ -n "${API_KEY:-}" && "$API_KEY" != "None" ]]; then
  echo "$API_KEY" | npx wrangler secret put API_KEY
  echo "==> Synced API_KEY secret from App Runner"
else
  echo "Warning: could not read API_KEY from App Runner; set API_KEY env var and re-run." >&2
fi

npm run deploy
echo ""
echo "Configure iPhone app Engine server to your workers.dev URL (see wrangler output)."
