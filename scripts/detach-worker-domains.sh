#!/usr/bin/env bash
# Detach Worker custom domains that lock borderchess.org DNS records.
# Run before pointing DNS to CloudFront. Requires wrangler login.
set -euo pipefail

WORKER_DIR="$(cd "$(dirname "$0")/../server/worker" && pwd)"
ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-ffa3431318bcf3e00e1e6d24cbf8f7a0}"

TOKEN="$(cd "$WORKER_DIR" && npx wrangler auth token 2>/dev/null | tail -1)"
[[ -n "$TOKEN" ]] || { echo "FATAL: wrangler not logged in" >&2; exit 1; }

DOMAINS="$(/usr/bin/curl -sf "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/domains" \
  -H "Authorization: Bearer ${TOKEN}")"

COUNT="$(python3 - <<PY
import json, sys
data = json.loads("""${DOMAINS}""")
print(len(data.get("result") or []))
PY
)"

if [[ "$COUNT" == "0" ]]; then
  echo "No Worker custom domains attached."
  exit 0
fi

python3 - <<PY
import json, subprocess, os
data = json.loads("""${DOMAINS}""")
token = os.environ["TOKEN"]
account = os.environ["ACCOUNT"]
for d in data.get("result") or []:
    hid = d["id"]
    host = d["hostname"]
    subprocess.run([
        "curl", "-sf", "-X", "DELETE",
        f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/domains/{hid}",
        "-H", f"Authorization: Bearer {token}",
    ], check=True)
    print(f"Detached {host}")
PY

echo "Done. Refresh Cloudflare DNS — locked Worker rows should be gone."
