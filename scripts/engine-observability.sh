#!/usr/bin/env bash
# Tail engine logs and show App Runner metrics/alarms (us-east-1).
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
STACK="${STACK_NAME:-chess-border-engine}"
SERVICE_NAME="chess-border-engine"
FOLLOW="${FOLLOW:-0}"
SINCE="${SINCE:-1h}"

echo "==> Stack ${STACK} (${REGION})"
aws cloudformation describe-stacks \
  --stack-name "$STACK" \
  --region "$REGION" \
  --query "Stacks[0].Outputs" \
  --output table 2>/dev/null || { echo "Stack not found." >&2; exit 1; }

echo ""
echo "==> CloudWatch dashboard"
echo "https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#dashboards:name=${STACK}-engine"

echo ""
echo "==> Alarms"
aws cloudwatch describe-alarms \
  --alarm-name-prefix "${STACK}-" \
  --region "$REGION" \
  --query 'MetricAlarms[*].{Name:AlarmName,State:StateValue,Reason:StateReason}' \
  --output table 2>/dev/null || echo "(none or no access)"

echo ""
echo "==> Log groups"
PREFIX="/aws/apprunner/${SERVICE_NAME}"
aws logs describe-log-groups \
  --log-group-name-prefix "$PREFIX" \
  --region "$REGION" \
  --query 'logGroups[*].{Name:logGroupName,Retention:retentionInDays,StoredMB:storedBytes}' \
  --output table

APP_LOG="$(aws logs describe-log-groups \
  --log-group-name-prefix "$PREFIX" \
  --region "$REGION" \
  --query 'logGroups[?contains(logGroupName, `application`)].logGroupName | [0]' \
  --output text 2>/dev/null || true)"

if [[ -z "$APP_LOG" || "$APP_LOG" == "None" ]]; then
  echo "No application log group under ${PREFIX} yet."
  exit 0
fi

echo ""
echo "==> Recent application logs (${SINCE})"
if [[ "$FOLLOW" == "1" ]]; then
  aws logs tail "$APP_LOG" --follow --region "$REGION"
else
  aws logs tail "$APP_LOG" --since "$SINCE" --region "$REGION" | tail -80
fi
