#!/usr/bin/env bash
# Build web app and upload static site to S3 + invalidate CloudFront.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB="$ROOT/web"
STATIC_STACK="${STATIC_STACK_NAME:-chess-border-static}"
REGION="${AWS_REGION:-us-east-1}"

# Browsers must never keep a stale shell that points at deleted hashed bundles.
HTML_CACHE='no-cache, no-store, must-revalidate'
ASSET_CACHE='public, max-age=31536000, immutable'

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
  echo "(skip build - using existing dist/)"
fi

echo "==> Uploading /play/assets/ (content-hashed; keep old hashes for stale shells)"
aws s3 sync dist/assets/ "s3://${BUCKET}/play/assets/" \
  --region "$REGION" \
  --cache-control "$ASSET_CACHE"

echo "==> Uploading /play/index.html (never cache in browser)"
aws s3 cp dist/index.html "s3://${BUCKET}/play/index.html" \
  --region "$REGION" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "$HTML_CACHE"

aws s3 cp dist/logo_v2.png "s3://${BUCKET}/play/logo_v2.png" \
  --region "$REGION" \
  --content-type "image/png" \
  --cache-control "$ASSET_CACHE"

if [[ -d dist/pieces ]]; then
  aws s3 sync dist/pieces/ "s3://${BUCKET}/play/pieces/" \
    --region "$REGION" \
    --cache-control "$ASSET_CACHE"
fi

echo "==> Uploading /play redirect (no trailing slash)"
aws s3 cp static/play-redirect.html "s3://${BUCKET}/play" \
  --region "$REGION" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "$HTML_CACHE"

echo "==> Uploading landing + privacy"
aws s3 cp static/index.html "s3://${BUCKET}/index.html" \
  --region "$REGION" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "$HTML_CACHE"

aws s3 cp static/privacy/index.html "s3://${BUCKET}/privacy/index.html" \
  --region "$REGION" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "$HTML_CACHE"

echo "==> Uploading logo + piece SVGs (ChessBorder CDN paths)"
aws s3 cp public/logo_v2.png "s3://${BUCKET}/logo_v2.png" \
  --region "$REGION" \
  --content-type "image/png" \
  --cache-control "public, max-age=31536000, immutable"

aws s3 cp public/logo_v2.png "s3://${BUCKET}/ChessBorder/logo_v2.png" \
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
    --paths "/index.html" "/play" "/play/" "/play/index.html" "/privacy/index.html" "/play/assets/*" \
    --query 'Invalidation.Id' \
    --output text >/dev/null
else
  echo "Warning: no distribution ID - skip invalidation or set CHESS_STATIC_CF_DISTRIBUTION_ID." >&2
fi

echo ""
echo "Synced to s3://${BUCKET}/"
echo "  Site:  https://borderchess.org/ (after DNS → CloudFront)"
echo "  Game:  https://borderchess.org/play/"
echo "  Pieces: /ChessBorder/pieces/"
