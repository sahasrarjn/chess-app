#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DERIVED="$ROOT/build/DerivedData"
PROJECT="$ROOT/ChessBorder.xcodeproj"

DEST="${1:-mac}"

case "$DEST" in
  mac)
    ENGINE="$ROOT/ChessBorder/Resources/Engine/fairy-stockfish"
    if [[ ! -x "$ENGINE" ]]; then
      echo "Fairy-Stockfish not found. Running setup-engine.sh…"
      "$ROOT/scripts/setup-engine.sh"
    fi
    echo "Building native Mac app (ChessBorderMac)…"
    xcodebuild \
      -project "$PROJECT" \
      -scheme ChessBorderMac \
      -configuration Debug \
      -destination 'platform=macOS,arch=arm64' \
      -derivedDataPath "$DERIVED" \
      build
    APP="$DERIVED/Build/Products/Debug/Border Chess.app"
    echo "Launching: $APP"
    open "$APP"
    ;;
  sim)
    ENGINE="$ROOT/ChessBorder/Resources/Engine/fairy-stockfish-ios"
    if [[ ! -x "$ENGINE" ]]; then
      echo "Fairy-Stockfish (iOS) not found. Running setup-engine.sh…"
      "$ROOT/scripts/setup-engine.sh"
    fi
    echo "Building for iPhone 17 Simulator…"
    xcodebuild \
      -project "$PROJECT" \
      -scheme ChessBorder \
      -configuration Debug \
      -destination 'platform=iOS Simulator,name=iPhone 17' \
      -derivedDataPath "$DERIVED" \
      build
    APP="$DERIVED/Build/Products/Debug-iphonesimulator/ChessBorder.app"
    SIM_ID="$(xcrun simctl list devices available -j | python3 -c "
import json, sys
data = json.load(sys.stdin)
for runtime, devices in data.get('devices', {}).items():
    if 'iOS' not in runtime:
        continue
    for dev in devices:
        if dev.get('name') == 'iPhone 17' and dev.get('isAvailable'):
            print(dev['udid'])
            raise SystemExit(0)
for runtime, devices in data.get('devices', {}).items():
    if 'iOS' not in runtime:
        continue
    for dev in devices:
        if 'iPhone' in dev.get('name', '') and dev.get('isAvailable'):
            print(dev['udid'])
            raise SystemExit(0)
raise SystemExit(1)
")"
    if [[ -z "$SIM_ID" ]]; then
      echo "Could not find iPhone 17 simulator." >&2
      exit 1
    fi
    xcrun simctl boot "$SIM_ID" 2>/dev/null || true
    open -a Simulator
    xcrun simctl install "$SIM_ID" "$APP"
    xcrun simctl launch "$SIM_ID" com.sahasraranjan.chessborder
    ;;
  ios)
    echo "Building for iPhone (device)…"
    xcodebuild \
      -project "$PROJECT" \
      -scheme ChessBorder \
      -configuration Debug \
      -destination 'generic/platform=iOS' \
      -derivedDataPath "$DERIVED" \
      -allowProvisioningUpdates \
      build
    echo "Built: $DERIVED/Build/Products/Debug-iphoneos/ChessBorder.app"
    echo "Install via Xcode → Window → Devices and Simulators, or run from Xcode on a connected iPhone."
    ;;
  *)
    echo "Usage: ./run.sh [mac|sim|ios]" >&2
    echo "  mac  — native Mac app (default)" >&2
    echo "  sim  — iOS Simulator on Mac" >&2
    echo "  ios  — build for physical iPhone" >&2
    exit 1
    ;;
esac
