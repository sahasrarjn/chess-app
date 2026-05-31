#!/usr/bin/env bash
# Play random legal games against a live engine and require every move to pass parity.
set -euo pipefail

BASE_URL="${1:-http://localhost:8081}"
GAMES="${PARITY_SIM_GAMES:-8}"
PLIES="${PARITY_SIM_PLIES:-30}"
WEB="${WEB:-$(cd "$(dirname "$0")/../web" && pwd)}"

export ENGINE_URL="$BASE_URL"
export PARITY_SIM_GAMES="$GAMES"
export PARITY_SIM_PLIES="$PLIES"

cd "$WEB"
npm run test:parity-sim
