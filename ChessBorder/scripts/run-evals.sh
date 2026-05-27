#!/usr/bin/env bash
# Run Chess Border bot evals (macOS unit tests, no UI).
#
# Usage (from repo root or ChessBorder/):
#   ./scripts/run-evals.sh
#
# Requires: Xcode, xcodegen (`brew install xcodegen`)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DERIVED="${ROOT}/build/DerivedData"
DEST='platform=macOS,arch=arm64'

echo "==> xcodegen generate"
xcodegen generate

echo "==> xcodebuild test (ChessBorderMac + ChessBorderTests)"
xcodebuild test \
  -project ChessBorder.xcodeproj \
  -scheme ChessBorderMac \
  -destination "$DEST" \
  -derivedDataPath "$DERIVED" \
  -only-testing:ChessBorderTests \
  CODE_SIGNING_ALLOWED=NO \
  | (command -v xcpretty >/dev/null && xcpretty --color || cat)

echo "==> Evals finished"
