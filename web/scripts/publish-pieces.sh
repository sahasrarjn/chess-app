#!/usr/bin/env bash
# Upload Border Chess web assets (piece SVGs, logo) to S3 / CloudFront.
# Prefer: ./web/scripts/sync-s3-static.sh (unified borderchess.org bucket).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PIECES_DIR="$ROOT/web/public/pieces"
LOGO="$ROOT/web/public/logo.png"

# shellcheck disable=SC1091
source "$ROOT/ChessBorder/scripts/release-env.sh"
chess_load_env "$ROOT/ChessBorder/scripts"

BUCKET="${CHESS_DOWNLOAD_BUCKET:-${BRAIN_DOWNLOAD_BUCKET:-brain-downloads-731049002088}}"
CF_DIST_ID="${CHESS_CF_DISTRIBUTION_ID:-${BRAIN_CF_DISTRIBUTION_ID:-EC6D5X1HA219F}}"
CF_BASE="${CHESS_DOWNLOAD_URL:-https://dkxinbm7riorm.cloudfront.net}"
PREFIX="ChessBorder/pieces"
LOGO_KEY="ChessBorder/logo.png"

chess_require_aws_publish

[[ -d "$PIECES_DIR" ]] || { echo "FATAL: $PIECES_DIR not found" >&2; exit 1; }
[[ -f "$LOGO" ]] || { echo "FATAL: $LOGO not found" >&2; exit 1; }

echo "==> Uploading piece SVGs…"
for svg in "$PIECES_DIR"/*.svg; do
  name="$(basename "$svg")"
  aws s3 cp "$svg" "s3://$BUCKET/$PREFIX/$name" \
    --content-type image/svg+xml \
    --cache-control "public, max-age=31536000, immutable"
done

echo "==> Uploading logo…"
aws s3 cp "$LOGO" "s3://$BUCKET/$LOGO_KEY" \
  --content-type image/png \
  --cache-control "public, max-age=31536000, immutable"

echo "==> Invalidating CloudFront…"
aws cloudfront create-invalidation \
  --distribution-id "$CF_DIST_ID" \
  --paths "/$PREFIX/*" "/$LOGO_KEY" \
  --query 'Invalidation.Id' \
  --output text >/dev/null

echo ""
echo "Live: $CF_BASE/$PREFIX/"
echo "Logo: $CF_BASE/$LOGO_KEY"
