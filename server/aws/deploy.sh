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

API_KEY="${API_KEY:-$(openssl rand -hex 16)}"

echo "==> Account ${ACCOUNT} region ${REGION}"
echo "==> Image ${IMAGE_URI}"
echo "==> API key (save for iPhone app): ${API_KEY}"

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

PARAMS=(ImageUri="${IMAGE_URI}" ApiKey="${API_KEY}")

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
echo "In the iPhone app home screen, set Engine server to:"
echo "  ${SERVICE_URL}"
echo "And API key to:"
echo "  ${API_KEY}"
