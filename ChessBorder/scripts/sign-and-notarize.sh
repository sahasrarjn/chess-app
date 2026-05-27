#!/usr/bin/env bash
# Developer ID sign + Apple notarization for Chess Border.app / .dmg
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/release-env.sh"
chess_load_env "$SCRIPT_DIR"

ENTITLEMENTS="$SCRIPT_DIR/../ChessBorder/ChessBorder.entitlements"

sign_one() {
  local target="$1"
  shift
  codesign --force --options runtime --timestamp \
    --sign "$DEVELOPER_ID" "$@" "$target"
}

sign_app() {
  chess_require_developer_id
  local app="$1"
  [[ -d "$app" ]] || { echo "FATAL: not a directory: $app" >&2; exit 1; }

  local engine="$app/Contents/Resources/Engine/fairy-stockfish"
  if [[ -f "$engine" ]]; then
    echo "    signing Fairy-Stockfish engine…"
    sign_one "$engine"
  fi

  echo "    signing app executable + bundle…"
  sign_one "$app/Contents/MacOS/Chess Border" --entitlements "$ENTITLEMENTS"
  sign_one "$app" --entitlements "$ENTITLEMENTS"
  codesign --verify --deep --strict "$app"
  echo "    Developer ID signature OK"
}

notarize_dmg() {
  local dmg="$1"
  [[ -f "$dmg" ]] || { echo "FATAL: not a file: $dmg" >&2; exit 1; }
  chess_notary_submit "$dmg"
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
  echo "    notarization OK"
}

case "${1:-}" in
  sign-app) sign_app "${2:?app path}" ;;
  notarize-dmg) notarize_dmg "${2:?dmg path}" ;;
  *)
    echo "Usage: $0 sign-app|notarize-dmg <path>" >&2
    exit 1
    ;;
esac
