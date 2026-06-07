#!/usr/bin/env bash
# Bump the iOS/Mac app version in one shot — keeps Info.plist and the Xcode
# build settings (MARKETING_VERSION / CURRENT_PROJECT_VERSION) in sync.
#
# Usage:
#   scripts/bump-version.sh <version> [build]   # set version; build defaults to current+1
#   scripts/bump-version.sh build               # keep version, increment build only (re-upload)
#   scripts/bump-version.sh                      # show current version/build
#
# CFBundleShortVersionString must increase for each App Store *version*;
# CFBundleVersion (build) must increase for each *upload* of a given version.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$ROOT/ChessBorder/ChessBorder/Info.plist"
PBXPROJ="$ROOT/ChessBorder/ChessBorder.xcodeproj/project.pbxproj"
PB=/usr/libexec/PlistBuddy

[[ -f "$PLIST" ]] || { echo "FATAL: $PLIST not found" >&2; exit 1; }

cur_version="$($PB -c 'Print :CFBundleShortVersionString' "$PLIST")"
cur_build="$($PB -c 'Print :CFBundleVersion' "$PLIST")"

if [[ $# -eq 0 ]]; then
  echo "Current: $cur_version (build $cur_build)"
  echo "Usage: $0 <version> [build]   |   $0 build"
  exit 0
fi

if [[ "$1" == "build" ]]; then
  new_version="$cur_version"
  new_build=$((cur_build + 1))
else
  new_version="$1"
  if ! [[ "$new_version" =~ ^[0-9]+(\.[0-9]+){1,2}$ ]]; then
    echo "FATAL: invalid version '$new_version' (expected x.y or x.y.z)" >&2
    exit 1
  fi
  if [[ $# -ge 2 ]]; then
    new_build="$2"
    [[ "$new_build" =~ ^[0-9]+$ ]] || { echo "FATAL: build must be an integer" >&2; exit 1; }
  else
    new_build=$((cur_build + 1))
  fi
fi

# Info.plist (explicit keys win for the App Store build).
$PB -c "Set :CFBundleShortVersionString $new_version" "$PLIST"
$PB -c "Set :CFBundleVersion $new_build" "$PLIST"

# Xcode build settings, all configs — kept in sync to avoid drift.
sed -i '' -E \
  -e "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $new_version;/g" \
  -e "s/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = $new_build;/g" \
  "$PBXPROJ"

echo "Bumped: $cur_version (build $cur_build)  ->  $new_version (build $new_build)"
echo "Next: Xcode > Product > Archive the 'ChessBorder' scheme, then upload."
