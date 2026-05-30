#!/usr/bin/env bash
# Rotate the backend API key on App Runner and sync it to the Cloudflare worker.
# Mobile/web clients do NOT need updates - only the worker talks to App Runner directly.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NEW_KEY="${1:-$(openssl rand -hex 32)}"

echo "==> Rotating backend API key"
export API_KEY="$NEW_KEY"
"${ROOT}/server/aws/deploy.sh"
API_KEY="$NEW_KEY" "${ROOT}/server/worker/deploy.sh"

echo ""
echo "Done."
echo "  New backend key is stored in App Runner + Cloudflare Worker secrets."
echo "  iPhone/web clients keep using the worker URL with no embedded secret."
echo ""
echo "If the old key was ever committed or leaked, assume it is compromised."
