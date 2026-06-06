#!/usr/bin/env bash
# Build, push, and deploy Chess Border engine to AWS App Runner (~$8/mo dev).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK_NAME="${STACK_NAME:-chess-border-engine}"
REGION="${AWS_REGION:-us-east-1}"
REPO_NAME="chess-border-engine"
IMAGE_TAG="${IMAGE_TAG:-latest}"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"
IMAGE_URI="${ECR_URI}:${IMAGE_TAG}"

SERVICE_ARN_PRE="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceArn'].OutputValue" \
  --output text 2>/dev/null || true)"

# App Runner describe-service redacts secrets as the literal string "None" — never reuse that.
if [[ -z "${API_KEY:-}" && -n "$SERVICE_ARN_PRE" && "$SERVICE_ARN_PRE" != "None" ]]; then
  API_KEY="$(aws apprunner describe-service \
    --service-arn "$SERVICE_ARN_PRE" \
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
API_KEY="${API_KEY:-}"
if [[ "$API_KEY" == "None" || "$API_KEY" == "null" || ${#API_KEY} -lt 32 ]]; then
  unset API_KEY
fi

KEY_SOURCE="new stack"
if [[ -n "${API_KEY:-}" ]]; then
  KEY_SOURCE="explicit env"
elif [[ -n "$SERVICE_ARN_PRE" && "$SERVICE_ARN_PRE" != "None" ]]; then
  KEY_SOURCE="unchanged (CFN previous value)"
else
  API_KEY="$(openssl rand -hex 32)"
fi

echo "==> Account ${ACCOUNT} region ${REGION}"
echo "==> Image ${IMAGE_URI}"
echo "==> API key ${KEY_SOURCE} (stored in AWS; not printed)"
if [[ -z "${ALERT_EMAIL:-}" ]]; then
  echo "WARN No ALERT_EMAIL — CloudWatch alarms will not email you. Example:"
  echo "     ALERT_EMAIL=you@example.com ./server/aws/deploy.sh"
fi

echo "==> Ensuring ECR repository exists"
aws ecr describe-repositories --repository-names "$REPO_NAME" --region "$REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$REPO_NAME" --region "$REGION" >/dev/null

echo "==> Logging in to ECR"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

echo "==> Building Docker image (linux/amd64 for App Runner)"
docker build --platform linux/amd64 \
  -f "${ROOT}/server/Dockerfile" \
  -t "${REPO_NAME}:${IMAGE_TAG}" \
  "${ROOT}"

docker tag "${REPO_NAME}:${IMAGE_TAG}" "${IMAGE_URI}"

echo "==> Pushing to ECR"
docker push "${IMAGE_URI}"

PARAMS=(ImageUri="${IMAGE_URI}")
if [[ -n "${API_KEY:-}" ]]; then
  PARAMS+=(ApiKey="${API_KEY}")
fi
if [[ -n "${ALERT_EMAIL:-}" ]]; then
  PARAMS+=(AlertEmail="${ALERT_EMAIL}")
fi

echo "==> Deploying CloudFormation stack ${STACK_NAME}"
aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "${ROOT}/server/aws/template.yaml" \
  --parameter-overrides "${PARAMS[@]}" \
  --capabilities CAPABILITY_IAM \
  --region "$REGION" \
  --no-fail-on-empty-changeset

SERVICE_URL="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" \
  --output text)"

echo ""
echo "Deployed."
echo "  Engine URL: ${SERVICE_URL}"
echo "  Health:     curl ${SERVICE_URL}/health"
echo ""

SERVICE_ARN="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceArn'].OutputValue" \
  --output text)"

if [[ -n "$SERVICE_ARN" && "$SERVICE_ARN" != "None" ]]; then
  echo "==> Starting App Runner deployment (${IMAGE_TAG})"
  aws apprunner start-deployment --service-arn "$SERVICE_ARN" --region "$REGION" >/dev/null
  for _ in $(seq 1 36); do
    STATUS="$(aws apprunner describe-service \
      --service-arn "$SERVICE_ARN" \
      --region "$REGION" \
      --query 'Service.Status' \
      --output text)"
    if [[ "$STATUS" == "RUNNING" ]]; then
      echo "==> App Runner is RUNNING"
      break
    fi
    sleep 10
  done
fi

LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-30}"
echo "==> CloudWatch log retention (${LOG_RETENTION_DAYS} days)"
while IFS= read -r lg; do
  [[ -z "$lg" || "$lg" == "None" ]] && continue
  aws logs put-retention-policy \
    --log-group-name "$lg" \
    --retention-in-days "$LOG_RETENTION_DAYS" \
    --region "$REGION" >/dev/null
  echo "     ${lg}"
done < <(aws logs describe-log-groups \
  --log-group-name-prefix "/aws/apprunner/chess-border-engine" \
  --region "$REGION" \
  --query 'logGroups[].logGroupName' \
  --output json 2>/dev/null | python3 -c "import json,sys; print('\n'.join(json.load(sys.stdin)))" 2>/dev/null || true)

DASHBOARD="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DashboardName'].OutputValue" \
  --output text 2>/dev/null || true)"

echo ""
echo "Monitoring:"
echo "  Dashboard: https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#dashboards:name=${DASHBOARD:-chess-border-engine-engine}"
echo "  Logs:      ./scripts/engine-observability.sh"
echo "  Tail:      FOLLOW=1 ./scripts/engine-observability.sh"
if [[ -n "${ALERT_EMAIL:-}" ]]; then
  echo "  Alarms:    email → ${ALERT_EMAIL} (confirm SNS subscription in inbox)"
fi

echo ""
echo "Next:"
echo "  ./server/worker/deploy.sh   # sync ENGINE_ORIGIN + API_KEY to Cloudflare"
echo "  ./scripts/verify-site.sh"
echo ""
echo "Clients use borderchess.org only — not App Runner directly."
