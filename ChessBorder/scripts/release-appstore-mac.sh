#!/usr/bin/env bash
# Archive + export Border Chess (macOS) for Mac App Store, optionally upload to App Store Connect.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
ARCHIVE="$ROOT/build/ChessBorderMac.xcarchive"
EXPORT_DIR="$ROOT/build/appstore-mac"
PROJECT="$ROOT/ChessBorder.xcodeproj"
EXPORT_OPTS="$SCRIPT_DIR/ExportOptions-appstore-mac.plist"
ENTITLEMENTS="$ROOT/ChessBorder/ChessBorderAppStore.entitlements"
UPLOAD=0

usage() {
  cat <<'EOF'
Usage: release-appstore-mac.sh [--upload]

  --upload   Upload exported .pkg to App Store Connect (requires API key in .env)

Without --upload, exports a signed .pkg locally. Upload manually via Transporter.app
or re-run with --upload after configuring App Store Connect API credentials.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --upload) UPLOAD=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

# shellcheck disable=SC1091
source "$SCRIPT_DIR/release-env.sh"
chess_load_env "$SCRIPT_DIR"

ENGINE="$ROOT/ChessBorder/Resources/Engine/fairy-stockfish"
if [[ ! -x "$ENGINE" ]]; then
  echo "==> Building Fairy-Stockfish…"
  "$REPO_ROOT/ChessBorder/scripts/setup-engine.sh" 2>/dev/null || "$REPO_ROOT/scripts/setup-engine.sh"
fi

if [[ ! -d "$PROJECT" ]]; then
  echo "==> Generating Xcode project…"
  (cd "$ROOT" && xcodegen generate)
fi

[[ -f "$ENTITLEMENTS" ]] || { echo "FATAL: missing $ENTITLEMENTS" >&2; exit 1; }

echo "==> Archive (macOS App Store)…"
xcodebuild \
  -project "$PROJECT" \
  -scheme ChessBorderMac \
  -configuration Release \
  -destination 'generic/platform=macOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  "CODE_SIGN_ENTITLEMENTS=$ENTITLEMENTS" \
  archive

echo "==> Export App Store .pkg…"
rm -rf "$EXPORT_DIR"
# shellcheck disable=SC2046
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTS" \
  -allowProvisioningUpdates \
  $(chess_appstore_xcodebuild_auth)

PKG="$(find "$EXPORT_DIR" -name '*.pkg' | head -1)"
[[ -n "$PKG" ]] || { echo "FATAL: no .pkg exported to $EXPORT_DIR" >&2; exit 1; }

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleShortVersionString' "$ARCHIVE/Info.plist" 2>/dev/null || echo "?")"
BUILD="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$ARCHIVE/Info.plist" 2>/dev/null || echo "?")"

echo ""
echo "Exported App Store build:"
echo "  Version: $VERSION ($BUILD)"
echo "  Archive: $ARCHIVE"
echo "  Package: $PKG"
echo ""

if [[ "$UPLOAD" -eq 1 ]]; then
  echo "==> Uploading to App Store Connect…"
  chess_appstore_upload_pkg "$PKG"
  echo ""
  echo "Upload complete. Open App Store Connect to submit for TestFlight or App Store review."
else
  echo "Next:"
  echo "  Upload:  ./scripts/release-appstore-mac.sh --upload"
  echo "  Or drop $PKG into Transporter.app"
  echo "  Then:    App Store Connect → TestFlight / App Store → submit for review"
  echo ""
  echo "See ChessBorder/scripts/README.md for the full publish workflow."
fi
