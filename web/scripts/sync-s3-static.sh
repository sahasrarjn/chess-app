#!/usr/bin/env bash
# Build web app and upload static site to S3 + invalidate CloudFront.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB="$ROOT/web"
STATIC_STACK="${STATIC_STACK_NAME:-chess-border-static}"
REGION="${AWS_REGION:-us-east-1}"

# shellcheck disable=SC1091
source "$ROOT/ChessBorder/scripts/release-env.sh"
chess_load_env "$ROOT/ChessBorder/scripts"

resolve_bucket() {
  if [[ -n "${CHESS_STATIC_BUCKET:-}" ]]; then
    echo "$CHESS_STATIC_BUCKET"
    return
  fi
  aws cloudformation describe-stacks \
    --stack-name "$STATIC_STACK" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='StaticBucketName'].OutputValue" \
    --output text 2>/dev/null || true
}

resolve_distribution() {
  if [[ -n "${CHESS_STATIC_CF_DISTRIBUTION_ID:-}" ]]; then
    echo "$CHESS_STATIC_CF_DISTRIBUTION_ID"
    return
  fi
  aws cloudformation describe-stacks \
    --stack-name "$STATIC_STACK" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
    --output text 2>/dev/null || true
}

chess_require_aws_publish

BUCKET="$(resolve_bucket)"
DIST_ID="$(resolve_distribution)"

if [[ -z "$BUCKET" || "$BUCKET" == "None" ]]; then
  echo "FATAL: set CHESS_STATIC_BUCKET or deploy ./server/aws/deploy-static.sh first." >&2
  exit 1
fi

echo "==> Building web app"
cd "$WEB"
if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  npm run build
else
  echo "(skip build — using existing dist/)"
fi

echo "==> Uploading /play/ (game bundle)"
aws s3 sync dist/ "s3://${BUCKET}/play/" \
  --delete \
  --region "$REGION" \
  --cache-control "public, max-age=3600" \
  --exclude "assets/*"

aws s3 sync dist/assets/ "s3://${BUCKET}/play/assets/" \
  --delete \
  --region "$REGION" \
  --cache-control "public, max-age=31536000, immutable"

echo "==> Uploading landing + privacy"
aws s3 cp static/index.html "s3://${BUCKET}/index.html" \
  --region "$REGION" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "public, max-age=300"

aws s3 cp static/privacy/index.html "s3://${BUCKET}/privacy/index.html" \
  --region "$REGION" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "public, max-age=3600"

echo "==> Uploading logo + piece SVGs (ChessBorder CDN paths)"
aws s3 cp public/logo.png "s3://${BUCKET}/logo.png" \
  --region "$REGION" \
  --content-type "image/png" \
  --cache-control "public, max-age=31536000, immutable"

aws s3 cp public/logo.png "s3://${BUCKET}/ChessBorder/logo.png" \
  --region "$REGION" \
  --content-type "image/png" \
  --cache-control "public, max-age=31536000, immutable"

for svg in public/pieces/*.svg; do
  name="$(basename "$svg")"
  aws s3 cp "$svg" "s3://${BUCKET}/ChessBorder/pieces/${name}" \
    --region "$REGION" \
    --content-type "image/svg+xml" \
    --cache-control "public, max-age=31536000, immutable"
done

if [[ -n "$DIST_ID" && "$DIST_ID" != "None" ]]; then
  echo "==> Invalidating CloudFront (${DIST_ID})"
  aws cloudfront create-invalidation \
    --distribution-id "$DIST_ID" \
    --paths "/*" \
    --query 'Invalidation.Id' \
    --output text >/dev/null
else
  echo "Warning: no distribution ID — skip invalidation or set CHESS_STATIC_CF_DISTRIBUTION_ID." >&2
fi

echo ""
echo "Synced to s3://${BUCKET}/"
echo "  Site:  https://borderchess.org/ (after DNS → CloudFront)"
echo "  Game:  https://borderchess.org/play/"
echo "  Pieces: /ChessBorder/pieces/"
