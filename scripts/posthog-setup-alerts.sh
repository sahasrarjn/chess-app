#!/usr/bin/env bash
# Create PostHog saved insights for bot health monitoring (run after deploy).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/.env" 2>/dev/null || true

if [[ -z "${POSTHOG_API_KEY:-}" ]]; then
  echo "FATAL: set POSTHOG_API_KEY in .env" >&2
  exit 1
fi

PROJECT="${POSTHOG_PROJECT_ID:-91067}"
API="https://us.posthog.com/api/projects/${PROJECT}/insights/"

create_insight() {
  local name="$1"
  local query="$2"
  curl -sS -X POST "$API" \
    -H "Authorization: Bearer $POSTHOG_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(python3 - <<PY
import json
print(json.dumps({
  "name": "$name",
  "query": {
    "kind": "InsightVizNode",
    "source": {
      "kind": "TrendsQuery",
      "series": [{
        "kind": "EventsNode",
        "event": "$name",
        "custom_name": "$name",
      }],
      "dateRange": {"date_from": "-7d"},
    },
  },
  "filters": {},
}))
PY
)" >/dev/null 2>&1 || true
}

create_hogql_insight() {
  local name="$1"
  local hogql="$2"
  curl -sS -X POST "$API" \
    -H "Authorization: Bearer $POSTHOG_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "import json; print(json.dumps({'name': '''$name''', 'query': {'kind': 'DataVisualizationNode', 'source': {'kind': 'HogQLQuery', 'query': '''$hogql'''}}}))")" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''), d.get('name', d.get('detail','created')))"
}

echo "==> PostHog monitoring insights (project ${PROJECT})"

create_hogql_insight "Bot fallback rate (7d)" \
  "SELECT countIf(event='bot_move' AND properties.used_fallback=true) / countIf(event='bot_move') as rate FROM events WHERE timestamp > now() - interval 7 day"

create_hogql_insight "Bot move rejections (7d)" \
  "SELECT toDate(timestamp) d, count() c FROM events WHERE event='bot_move_rejected' AND timestamp > now() - interval 7 day GROUP BY d ORDER BY d"

create_hogql_insight "Rageclicks on /play/ (7d)" \
  "SELECT toDate(timestamp) d, count() c FROM events WHERE event='\$rageclick' AND properties.\`\$pathname\`='/play/' AND timestamp > now() - interval 7 day GROUP BY d ORDER BY d"

create_hogql_insight "Slow bot moves p90 elapsed_ms" \
  "SELECT quantile(0.9)(toFloat(properties.elapsed_ms)) FROM events WHERE event='bot_move' AND timestamp > now() - interval 7 day"

echo ""
echo "Insights created/updated in PostHog."
echo "In PostHog → Insights, open each chart → Subscribe → set email/Slack alert when:"
echo "  • fallback rate > 0.01"
echo "  • bot_move_rejected count > 0/day"
echo "  • rageclicks spike > 10/day"
echo "  • p90 elapsed_ms > 10000"
