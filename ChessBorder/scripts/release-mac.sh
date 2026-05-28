#!/usr/bin/env bash
# Build, sign, notarize, and publish Chess Border for macOS + iOS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
DERIVED="$ROOT/build/DerivedData"
APP_NAME="Border Chess"
APP="$DERIVED/Build/Products/Release/Border Chess.app"
DMG="$ROOT/build/ChessBorder.dmg"
PROJECT="$ROOT/ChessBorder.xcodeproj"

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

echo "==> Release build (macOS arm64)…"
xcodebuild \
  -project "$PROJECT" \
  -scheme ChessBorderMac \
  -configuration Release \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$DERIVED" \
  clean build

[[ -d "$APP" ]] || { echo "FATAL: $APP not found" >&2; exit 1; }

if [[ -n "${DEVELOPER_ID:-}" ]]; then
  echo "==> Signing with Developer ID…"
  "$SCRIPT_DIR/sign-and-notarize.sh" sign-app "$APP"
else
  echo "==> Ad-hoc sign (no DEVELOPER_ID in .env)"
  codesign --force --deep --sign - "$APP"
fi

echo "==> Creating DMG…"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/$APP_NAME.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -quiet -volname "Border Chess" -srcfolder "$STAGE" -ov -format UDZO "$DMG"

if [[ -n "${DEVELOPER_ID:-}" && -n "$(chess_notary_mode)" ]]; then
  echo "==> Notarizing DMG (may take several minutes)…"
  "$SCRIPT_DIR/sign-and-notarize.sh" notarize-dmg "$DMG"
fi

echo ""
echo "Built:"
echo "  $APP"
echo "  $DMG"
echo ""
echo "Next: ./scripts/publish-release.sh"
