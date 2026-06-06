#!/usr/bin/env bash
# Warn when borderchess.org DNS differs across public resolvers (common "site down" cause).
set -euo pipefail

HOST="${1:-borderchess.org}"
CF_DOMAIN="${CF_DOMAIN:-di1tio2w97i7r.cloudfront.net}"
FAIL=0

resolve_a() {
  dig +short "$HOST" A @"$1" 2>/dev/null | sort -u | paste -sd, -
}

echo "==> ${HOST} A records by resolver"
for r in 1.1.1.1 8.8.8.8 9.9.9.9; do
  ips="$(resolve_a "$r")"
  echo "  ${r}: ${ips:-<none>}"
done

if dig +short "$HOST" A @1.1.1.1 2>/dev/null | grep -qE '^(104\.(1[6-9]|2[0-9]|3[01])\.|172\.6[47]\.)'; then
  echo "WARN: 1.1.1.1 still sees Cloudflare orange-cloud proxy IPs on apex."
  echo "      Fix: ./scripts/cloudflare-dns-cutover.sh"
  FAIL=1
fi

uniq_sets="$(for r in 1.1.1.1 8.8.8.8 9.9.9.9; do resolve_a "$r"; done | sort -u | wc -l | tr -d ' ')"
if [[ "$uniq_sets" -gt 1 ]]; then
  echo "NOTE: resolvers return different A sets (often normal CloudFront edge IPs + DNS cache)."
  echo "      Re-run cutover if orange-cloud; otherwise wait for TTL (~5 min)."
fi

cname="$(dig +short "$HOST" CNAME @1.1.1.1 2>/dev/null | head -1 || true)"
if [[ -n "$cname" && "$cname" != *cloudfront.net* ]]; then
  echo "WARN: apex CNAME is not CloudFront: ${cname}"
  FAIL=1
fi

echo ""
echo "==> HTTPS smoke"
code="$(curl -s -o /dev/null -w "%{http_code}" -m 15 "https://${HOST}/" || echo 000)"
if [[ "$code" == "200" ]]; then
  echo "OK   https://${HOST}/ ($code)"
else
  echo "FAIL https://${HOST}/ ($code)"
  FAIL=1
fi

code_cf="$(curl -s -o /dev/null -w "%{http_code}" -m 15 "https://${CF_DOMAIN}/" -H "Host: ${HOST}" || echo 000)"
if [[ "$code_cf" == "200" ]]; then
  echo "OK   CloudFront origin (${CF_DOMAIN})"
else
  echo "FAIL CloudFront origin ($code_cf)"
  FAIL=1
fi

exit "$FAIL"
