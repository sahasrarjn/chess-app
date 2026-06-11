#!/usr/bin/env bash
# Build the accounts Lambda and deploy the HTTP API stack.
# Requires AWS creds (set AWS_PROFILE=sahasralabs for the production account).
#
# JWT secret: canonical copy lives in SSM (SecureString). Generated here on
# first deploy; passed to CFN as a NoEcho parameter -> Lambda env var
# (CFN cannot resolve ssm-secure into Lambda environment variables).
#
# Client IDs: pass GOOGLE_CLIENT_IDS / APPLE_CLIENT_IDS (comma-separated) to
# set or rotate; omit to keep the previous stack values.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAMBDA_DIR="$ROOT/server/accounts"
STACK="${ACCOUNTS_STACK_NAME:-chess-border-accounts}"
REGION="${AWS_REGION:-us-east-1}"
SECRET_PARAM="${ACCOUNTS_JWT_SECRET_PARAM:-/chess-border/accounts/jwt-secret}"

command -v aws >/dev/null || { echo "FATAL: aws CLI required" >&2; exit 1; }

echo "==> Ensuring JWT secret in SSM ($SECRET_PARAM)"
if ! aws ssm get-parameter --name "$SECRET_PARAM" --region "$REGION" >/dev/null 2>&1; then
  aws ssm put-parameter \
    --name "$SECRET_PARAM" \
    --type SecureString \
    --value "$(openssl rand -hex 32)" \
    --region "$REGION" >/dev/null
  echo "    generated new secret"
fi
JWT_SECRET="$(aws ssm get-parameter \
  --name "$SECRET_PARAM" --with-decryption --region "$REGION" \
  --query 'Parameter.Value' --output text)"
if [[ -z "$JWT_SECRET" || "$JWT_SECRET" == "None" || ${#JWT_SECRET} -lt 32 ]]; then
  echo "FATAL: could not read a valid JWT secret from SSM" >&2
  exit 1
fi

echo "==> Building Lambda bundle"
cd "$LAMBDA_DIR"
if [[ "${SKIP_INSTALL:-}" != "1" ]]; then
  npm install --no-fund --no-audit
fi
npm run build
( cd dist && zip -q -j lambda.zip index.js )

PARAMS=(JwtSecret="$JWT_SECRET")
if [[ -n "${GOOGLE_CLIENT_IDS:-}" ]]; then
  PARAMS+=(GoogleClientIds="$GOOGLE_CLIENT_IDS")
fi
if [[ -n "${APPLE_CLIENT_IDS:-}" ]]; then
  PARAMS+=(AppleClientIds="$APPLE_CLIENT_IDS")
fi

echo "==> Deploying CloudFormation stack ($STACK)"
aws cloudformation deploy \
  --template-file "$ROOT/server/aws/accounts.yaml" \
  --stack-name "$STACK" \
  --parameter-overrides "${PARAMS[@]}" \
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

API_URL="$(aws cloudformation describe-stacks \
  --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)"

echo ""
echo "Accounts deployed."
echo "  API URL: $API_URL"
echo ""
echo "Web build (with the Google web client ID):"
echo "  export VITE_ACCOUNTS_API_URL=\"$API_URL\""
echo "  export VITE_GOOGLE_CLIENT_ID=\"<web-client-id>.apps.googleusercontent.com\""
echo "iOS: set AccountsServerURL=$API_URL and GoogleClientID in ChessBorder/project.yml, then xcodegen."
echo ""
echo "Smoke check:"
echo "  curl -s -o /dev/null -w '%{http_code}' \"$API_URL/v1/me\"   # expect 401"
