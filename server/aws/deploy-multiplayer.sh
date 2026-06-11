#!/usr/bin/env bash
# Build the multiplayer Lambda and deploy the WebSocket stack.
# Requires AWS creds (set AWS_PROFILE=sahasralabs for the production account).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAMBDA_DIR="$ROOT/server/multiplayer"
STACK="${MULTIPLAYER_STACK_NAME:-chess-border-multiplayer}"
REGION="${AWS_REGION:-us-east-1}"

command -v aws >/dev/null || { echo "FATAL: aws CLI required" >&2; exit 1; }

echo "==> Building Lambda bundle"
cd "$LAMBDA_DIR"
if [[ "${SKIP_INSTALL:-}" != "1" ]]; then
  npm install --no-fund --no-audit
fi
npm run build
( cd dist && zip -q -j lambda.zip index.js )

echo "==> Resolving session JWT secret from SSM"
SECRET_PARAM="${ACCOUNTS_JWT_SECRET_PARAM:-/chess-border/accounts/jwt-secret}"
PARAMS=()
JWT_SECRET="$(aws ssm get-parameter \
  --name "$SECRET_PARAM" --with-decryption --region "$REGION" \
  --query 'Parameter.Value' --output text 2>/dev/null || true)"
if [[ -n "$JWT_SECRET" && "$JWT_SECRET" != "None" && ${#JWT_SECRET} -ge 32 ]]; then
  PARAMS+=(SessionJwtSecret="$JWT_SECRET")
else
  echo "WARN: $SECRET_PARAM not found in SSM - online game recording will stay disabled"
  echo "      (run server/aws/deploy-accounts.sh first to create it)"
fi

echo "==> Deploying CloudFormation stack ($STACK)"
aws cloudformation deploy \
  --template-file "$ROOT/server/aws/multiplayer.yaml" \
  --stack-name "$STACK" \
  ${PARAMS[@]+--parameter-overrides "${PARAMS[@]}"} \
  --capabilities CAPABILITY_IAM \
  --region "$REGION" \
  --no-fail-on-empty-changeset

FUNCTION_NAME="$(aws cloudformation describe-stacks \
  --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionName'].OutputValue" --output text)"

echo "==> Uploading function code to $FUNCTION_NAME"
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb://$LAMBDA_DIR/dist/lambda.zip" \
  --region "$REGION" \
  --output text --query 'LastModified' >/dev/null

WS_URL="$(aws cloudformation describe-stacks \
  --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='WebSocketURL'].OutputValue" --output text)"

echo ""
echo "Multiplayer deployed."
echo "  WebSocket URL: $WS_URL"
echo ""
echo "Set this for the web build, then sync the site:"
echo "  export VITE_MULTIPLAYER_WS_URL=\"$WS_URL\""
