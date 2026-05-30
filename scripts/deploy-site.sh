#!/usr/bin/env bash
# Full production deploy — engine, static (worker + S3), API worker, verify.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 1/4 Engine (AWS App Runner)"
"${ROOT}/server/aws/deploy.sh"

echo ""
echo "==> 2/4 Static assets (S3 + CloudFront)"
"${ROOT}/web/scripts/sync-all-static.sh"

echo ""
echo "==> 3/4 API worker (Cloudflare)"
"${ROOT}/server/worker/deploy.sh"

echo ""
echo "==> 4/4 Verify live site"
"${ROOT}/scripts/verify-site.sh"

echo ""
echo "Deploy complete."
