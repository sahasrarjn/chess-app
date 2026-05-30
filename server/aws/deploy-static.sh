#!/usr/bin/env bash
# Deploy S3 + CloudFront static site stack (us-east-1). Run once, then sync-s3-static.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK_NAME="${STATIC_STACK_NAME:-chess-border-static}"
REGION="${AWS_REGION:-us-east-1}"

if [[ "$REGION" != "us-east-1" ]]; then
  echo "FATAL: CloudFront + ACM for custom domains must deploy in us-east-1 (got $REGION)." >&2
  exit 1
fi

PARAMS=(
  DomainName="${DOMAIN_NAME:-borderchess.org}"
  WwwDomainName="${WWW_DOMAIN_NAME:-www.borderchess.org}"
  WorkerOriginDomain="${WORKER_ORIGIN_DOMAIN:-chess-engine.sahasraranjan.workers.dev}"
  EnableWaf="${ENABLE_WAF:-true}"
  WafRateLimit="${WAF_RATE_LIMIT:-600}"
)

echo "==> Deploying static site stack ${STACK_NAME} (${REGION})"
aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "${ROOT}/server/aws/static-site.yaml" \
  --parameter-overrides "${PARAMS[@]}" \
  --region "$REGION" \
  --no-fail-on-empty-changeset

echo ""
echo "==> Stack outputs"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs" \
  --output table

CERT_ARN="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CertificateArn'].OutputValue" \
  --output text)"

echo ""
echo "==> ACM DNS validation records (add in Cloudflare before HTTPS works)"
aws acm describe-certificate \
  --certificate-arn "$CERT_ARN" \
  --region "$REGION" \
  --query "Certificate.DomainValidationOptions[].ResourceRecord" \
  --output table

DIST_DOMAIN="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomainName'].OutputValue" \
  --output text)"

BUCKET="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='StaticBucketName'].OutputValue" \
  --output text)"

echo ""
echo "Next:"
echo "  1. Add ACM validation CNAMEs in Cloudflare (wait until certificate ISSUED)"
echo "  2. CNAME ${DOMAIN_NAME:-borderchess.org} → ${DIST_DOMAIN} (DNS only / grey cloud)"
echo "  3. CNAME ${WWW_DOMAIN_NAME:-www.borderchess.org} → ${DIST_DOMAIN} (DNS only)"
echo "  4. Upload site: CHESS_STATIC_BUCKET=${BUCKET} ./web/scripts/sync-s3-static.sh"
echo "  5. Deploy API worker: ./server/worker/deploy.sh"
echo "  6. Remove Cloudflare Worker custom-domain routes for borderchess.org (wrangler.toml)"
