#!/bin/sh
# Xcode Cloud: optional local engine for iOS Simulator builds.
# App Store / device builds use the remote worker bot and do not need this binary.
set -eu

if [ "${CI_XCODEBUILD_ACTION:-}" = "archive" ]; then
  echo "Skipping Fairy-Stockfish build for archive (device uses remote engine)."
  exit 0
fi

cd "$CI_PRIMARY_REPOSITORY_PATH/ChessBorder"
./scripts/setup-engine.sh
