#!/usr/bin/env bash
# Build web app and copy into server/worker/public/play for Cloudflare deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/web"
npm run build
rm -rf "$ROOT/server/worker/public/play"
mkdir -p "$ROOT/server/worker/public/play"
cp -r dist/* "$ROOT/server/worker/public/play/"
cp public/logo.png "$ROOT/server/worker/public/play/logo.png"
echo "Synced to server/worker/public/play/"
