#!/usr/bin/env bash
# Build Fairy-Stockfish (GPL v3) for macOS and iOS Simulator bundling in Chess Border.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_DIR="$ROOT/ChessBorder/Resources/Engine"
BUILD_DIR="$ROOT/build/fairy-stockfish"
REPO="${FAIRY_STOCKFISH_REPO:-https://github.com/fairy-stockfish/Fairy-Stockfish.git}"
JOBS="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"

mkdir -p "$ENGINE_DIR" "$BUILD_DIR"

if [[ ! -d "$BUILD_DIR/.git" ]]; then
  git clone --depth 1 "$REPO" "$BUILD_DIR"
fi

cd "$BUILD_DIR/src"

echo "Building Fairy-Stockfish for macOS…"
make -j"$JOBS" build ARCH=apple-silicon COMP=clang COMPCXX=clang++ largeboards=yes
MAC_BIN="$BUILD_DIR/src/stockfish"
if [[ ! -x "$MAC_BIN" ]]; then
  echo "macOS build failed: $MAC_BIN not found" >&2
  exit 1
fi
cp "$MAC_BIN" "$ENGINE_DIR/fairy-stockfish"
chmod +x "$ENGINE_DIR/fairy-stockfish"
echo "Installed: $ENGINE_DIR/fairy-stockfish"
file "$ENGINE_DIR/fairy-stockfish"

echo "Building Fairy-Stockfish for iOS Simulator…"
make clean >/dev/null 2>&1 || true
SIM_SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
make -j"$JOBS" build \
  KERNEL=Linux \
  ARCH=armv8 \
  COMP=clang \
  COMPCXX="xcrun --sdk iphonesimulator clang++" \
  largeboards=yes \
  EXTRACXXFLAGS="-target arm64-apple-ios17.0-simulator -isysroot $SIM_SDK -stdlib=libc++" \
  EXTRALDFLAGS="-target arm64-apple-ios17.0-simulator -isysroot $SIM_SDK" \
  || true

IOS_BIN="$BUILD_DIR/src/stockfish"
if [[ ! -x "$IOS_BIN" ]]; then
  echo "Linking iOS Simulator binary (without -latomic)…"
  xcrun --sdk iphonesimulator clang++ \
    -o "$IOS_BIN" "$BUILD_DIR"/src/*.o \
    -target arm64-apple-ios17.0-simulator \
    -isysroot "$SIM_SDK" \
    -lpthread
fi

if [[ ! -x "$IOS_BIN" ]]; then
  echo "iOS Simulator build failed: $IOS_BIN not found" >&2
  exit 1
fi

cp "$IOS_BIN" "$ENGINE_DIR/fairy-stockfish-ios"
chmod +x "$ENGINE_DIR/fairy-stockfish-ios"
echo "Installed: $ENGINE_DIR/fairy-stockfish-ios"
file "$ENGINE_DIR/fairy-stockfish-ios"
