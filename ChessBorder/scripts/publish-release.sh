#!/usr/bin/env bash
# Upload Border Chess iOS IPA + OTA manifest to S3 / CloudFront.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IPA="$ROOT/build/ChessBorder.ipa"
MANIFEST="$ROOT/build/manifest.plist"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/release-env.sh"
chess_load_env "$SCRIPT_DIR"

BUCKET="${CHESS_DOWNLOAD_BUCKET:-${BRAIN_DOWNLOAD_BUCKET:-brain-downloads-888900520466}}"
CF_DIST_ID="${CHESS_CF_DISTRIBUTION_ID:-${BRAIN_CF_DISTRIBUTION_ID:-EC6D5X1HA219F}}"
CF_BASE="${CHESS_DOWNLOAD_URL:-https://dkxinbm7riorm.cloudfront.net}"
IPA_URL="${CF_BASE}/ChessBorder.ipa"
MANIFEST_URL="${CF_BASE}/ChessBorder-manifest.plist"

chess_require_aws_publish

[[ -f "$IPA" ]] || { echo "FATAL: $IPA not found - run ./scripts/release-ios.sh first" >&2; exit 1; }

PATHS=()

echo "==> Uploading IPA…"
aws s3 cp "$IPA" "s3://$BUCKET/ChessBorder.ipa" \
  --content-type application/octet-stream \
  --cache-control "public, max-age=86400"
PATHS+=("/ChessBorder.ipa")

if [[ -f "$MANIFEST" ]]; then
  echo "==> Uploading OTA manifest…"
  aws s3 cp "$MANIFEST" "s3://$BUCKET/ChessBorder-manifest.plist" \
    --content-type text/xml \
    --cache-control "public, max-age=300"
  PATHS+=("/ChessBorder-manifest.plist")
fi

echo "==> Invalidating CloudFront…"
aws cloudfront create-invalidation \
  --distribution-id "$CF_DIST_ID" \
  --paths "${PATHS[@]}" \
  --query 'Invalidation.Id' \
  --output text >/dev/null

echo ""
echo "Live:"
echo "  iOS IPA:  $IPA_URL"
echo "  OTA:      itms-services://?action=download-manifest&url=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MANIFEST_URL', safe=''))")"
echo "  Landing:  https://borderchess.org"
echo ""
echo "Deploy landing page: cd $ROOT/../server/worker && npm run deploy"
