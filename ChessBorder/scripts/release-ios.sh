#!/usr/bin/env bash
# Archive + export ad-hoc IPA for personal iPhone install.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARCHIVE="$ROOT/build/ChessBorder.xcarchive"
EXPORT_DIR="$ROOT/build/ipa"
IPA="$ROOT/build/ChessBorder.ipa"
PROJECT="$ROOT/ChessBorder.xcodeproj"
EXPORT_OPTS="$SCRIPT_DIR/ExportOptions-adhoc.plist"

if [[ ! -d "$PROJECT" ]]; then
  (cd "$ROOT" && xcodegen generate)
fi

echo "==> Archive (iOS device)…"
xcodebuild \
  -project "$PROJECT" \
  -scheme ChessBorder \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  archive

echo "==> Export ad-hoc IPA…"
rm -rf "$EXPORT_DIR"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTS" \
  -allowProvisioningUpdates

IPA_EXPORTED="$(find "$EXPORT_DIR" -name '*.ipa' | head -1)"
[[ -n "$IPA_EXPORTED" ]] || { echo "FATAL: no IPA exported" >&2; exit 1; }
cp "$IPA_EXPORTED" "$IPA"

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleShortVersionString' "$ARCHIVE/Info.plist" 2>/dev/null || echo 1.0.0)"
BUILD="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$ARCHIVE/Info.plist" 2>/dev/null || echo 1)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/release-env.sh"
chess_load_env "$SCRIPT_DIR"
CF_BASE="${CHESS_DOWNLOAD_URL:-https://dkxinbm7riorm.cloudfront.net}"
IPA_URL="${CF_BASE}/ChessBorder.ipa"

cat > "$ROOT/build/manifest.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${IPA_URL}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>com.sahasraranjan.chessborder</string>
        <key>bundle-version</key>
        <string>${BUILD}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>Border Chess</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
EOF

echo "Exported: $IPA"
echo "Manifest: $ROOT/build/manifest.plist"
echo "Run ./scripts/publish-release.sh to upload."
