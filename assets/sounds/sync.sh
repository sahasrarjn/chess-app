#!/usr/bin/env bash
# Distribute the canonical sound set to the web and iOS/Mac apps.
# Source of truth: assets/sounds/*.mp3 (see CREDITS.md / build_mp3.sh).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

WEB_DIR="$ROOT/web/public/sounds"
IOS_DIR="$ROOT/ChessBorder/ChessBorder/Assets.xcassets/Sounds"

mkdir -p "$WEB_DIR"
mkdir -p "$IOS_DIR"

# Asset-catalog namespace so iOS references assets as "Sounds/<name>".
cat > "$IOS_DIR/Contents.json" <<'JSON'
{
  "info" : { "author" : "xcode", "version" : 1 },
  "properties" : { "provides-namespace" : true }
}
JSON

for mp3 in "$HERE"/*.mp3; do
  name="$(basename "${mp3%.mp3}")"

  # Web: plain static file.
  cp "$mp3" "$WEB_DIR/$name.mp3"

  # iOS/Mac: a data set inside the asset catalog (auto-bundled by actool).
  ds="$IOS_DIR/$name.dataset"
  mkdir -p "$ds"
  cp "$mp3" "$ds/$name.mp3"
  cat > "$ds/Contents.json" <<JSON
{
  "info" : { "author" : "xcode", "version" : 1 },
  "data" : [ { "idiom" : "universal", "filename" : "$name.mp3" } ]
}
JSON
done

echo "web  -> $WEB_DIR"
ls -1 "$WEB_DIR"
echo "ios  -> $IOS_DIR"
ls -1 "$IOS_DIR"
