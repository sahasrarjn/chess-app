#!/usr/bin/env bash
# Build web app and sync static site to S3 + CloudFront.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec "${ROOT}/web/scripts/sync-s3-static.sh"
