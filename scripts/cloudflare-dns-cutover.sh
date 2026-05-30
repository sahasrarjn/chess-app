#!/usr/bin/env bash
# Add ACM validation + CloudFront DNS records in Cloudflare.
# Requires: CLOUDFLARE_API_TOKEN with Zone.DNS Edit for borderchess.org
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATIC_STACK="${STATIC_STACK_NAME:-chess-border-static}"
REGION="${AWS_REGION:-us-east-1}"
ZONE_NAME="${ZONE_NAME:-borderchess.org}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "FATAL: set CLOUDFLARE_API_TOKEN (Zone.DNS Edit on ${ZONE_NAME})." >&2
  echo "Create at: https://dash.cloudflare.com/profile/api-tokens" >&2
  exit 1
fi

zone_id() {
  curl -sf "https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    | python3 -c "import json,sys; r=json.load(sys.stdin)['result']; print(r[0]['id'] if r else '')"
}

upsert_cname() {
  local zone="$1" name="$2" target="$3"
  local existing
  existing="$(curl -sf "https://api.cloudflare.com/client/v4/zones/${zone}/dns_records?type=CNAME&name=${name}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    | python3 -c "import json,sys; r=json.load(sys.stdin)['result']; print(r[0]['id'] if r else '')")"
  local payload
  payload="$(python3 - <<PY
import json
print(json.dumps({
  "type": "CNAME",
  "name": "${name}",
  "content": "${target}",
  "ttl": 1,
  "proxied": False,
}))
PY
)"
  if [[ -n "$existing" ]]; then
    curl -sf -X PUT "https://api.cloudflare.com/client/v4/zones/${zone}/dns_records/${existing}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$payload" >/dev/null
    echo "Updated CNAME ${name} → ${target}"
  else
    curl -sf -X POST "https://api.cloudflare.com/client/v4/zones/${zone}/dns_records" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$payload" >/dev/null
    echo "Created CNAME ${name} → ${target}"
  fi
}

ZONE_ID="$(zone_id)"
if [[ -z "$ZONE_ID" ]]; then
  echo "FATAL: Cloudflare zone not found: ${ZONE_NAME}" >&2
  exit 1
fi

CERT_ARN="$(aws cloudformation describe-stack-resources \
  --stack-name "$STATIC_STACK" \
  --region "$REGION" \
  --query "StackResources[?ResourceType=='AWS::CertificateManager::Certificate'].PhysicalResourceId" \
  --output text)"

echo "==> ACM validation records"
aws acm describe-certificate \
  --certificate-arn "$CERT_ARN" \
  --region "$REGION" \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord' \
  --output json \
  | python3 - <<'PY' | while IFS='|' read -r name value; do
import json, sys
for rec in json.load(sys.stdin):
    name = rec["Name"].rstrip(".")
    if name.endswith("." + "borderchess.org"):
        short = name[: -len(".borderchess.org")]
    else:
        short = name
    print(f"{short}|{rec['Value']}")
PY
    upsert_cname "$ZONE_ID" "$name" "$value"
  done

DIST_DOMAIN="$(aws cloudformation describe-stacks \
  --stack-name "$STATIC_STACK" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomainName'].OutputValue" \
  --output text 2>/dev/null || true)"

if [[ -n "$DIST_DOMAIN" && "$DIST_DOMAIN" != "None" ]]; then
  echo "==> Site CNAMEs (DNS only / grey cloud)"
  upsert_cname "$ZONE_ID" "borderchess.org" "$DIST_DOMAIN"
  upsert_cname "$ZONE_ID" "www" "$DIST_DOMAIN"
  echo ""
  echo "CloudFront: https://${DIST_DOMAIN}/"
else
  echo ""
  echo "CloudFront distribution not ready yet."
  echo "Re-run after stack completes: aws cloudformation wait stack-create-complete --stack-name ${STATIC_STACK} --region ${REGION}"
  echo "Then run this script again to set site CNAMEs."
fi

echo ""
echo "Done. Wait for ACM ISSUED, then: CHESS_STATIC_CF_DISTRIBUTION_ID=... ./web/scripts/sync-s3-static.sh"
