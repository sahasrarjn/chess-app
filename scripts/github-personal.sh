#!/usr/bin/env bash
# Border Chess — personal GitHub account helpers (repo-local only).
#
# Primary account (everywhere else): sahasra098
# Personal account (this repo only):  set CHESS_GITHUB_USER after `gh auth login`
#
# Usage:
#   ./scripts/github-personal.sh status
#   ./scripts/github-personal.sh use-personal
#   ./scripts/github-personal.sh use-primary
#   ./scripts/github-personal.sh create-repo    # create public repo + push
#   ./scripts/github-personal.sh push           # push to existing origin

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRIMARY_USER="${CHESS_GITHUB_PRIMARY:-sahasra098}"
PERSONAL_USER="${CHESS_GITHUB_USER:-sahasrarjn}"
REPO_NAME="${CHESS_GITHUB_REPO:-chess-app}"

die() { echo "FATAL: $*" >&2; exit 1; }

gh_account() {
  gh api user --jq .login 2>/dev/null || echo "?"
}

switch_gh() {
  local user="$1"
  gh auth switch -u "$user" >/dev/null
  echo "gh active account: $(gh_account)"
}

ensure_personal_logged_in() {
  if ! gh auth status 2>&1 | grep -q "Logged in.*${PERSONAL_USER}"; then
    die "Personal account '${PERSONAL_USER}' not in gh. Run: gh auth login  (add account, do not log out of ${PRIMARY_USER})"
  fi
}

setup_remote_https() {
  local url="https://github.com/${PERSONAL_USER}/${REPO_NAME}.git"
  if git -C "$ROOT" remote get-url origin &>/dev/null; then
    git -C "$ROOT" remote set-url origin "$url"
  else
    git -C "$ROOT" remote add origin "$url"
  fi
  echo "origin → $url"
}

cmd_status() {
  echo "Configured (env overrides in parentheses):"
  echo "  Primary:  ${PRIMARY_USER}"
  echo "  Personal: ${PERSONAL_USER}  (CHESS_GITHUB_USER)"
  echo "  Repo:     ${REPO_NAME}      (CHESS_GITHUB_REPO)"
  echo ""
  gh auth status || true
  echo ""
  echo "Local git author (this repo only):"
  git -C "$ROOT" config --local user.name || true
  git -C "$ROOT" config --local user.email || true
  echo ""
  if git -C "$ROOT" remote get-url origin &>/dev/null; then
    echo "origin: $(git -C "$ROOT" remote get-url origin)"
  else
    echo "origin: (not set)"
  fi
}

cmd_use_personal() {
  ensure_personal_logged_in
  switch_gh "$PERSONAL_USER"
  setup_remote_https
  echo "Use './scripts/github-personal.sh use-primary' when you leave this project."
}

cmd_use_primary() {
  switch_gh "$PRIMARY_USER"
  echo "Back to primary account for other projects."
}

cmd_create_repo() {
  ensure_personal_logged_in
  switch_gh "$PERSONAL_USER"
  setup_remote_https
  if gh repo view "${PERSONAL_USER}/${REPO_NAME}" &>/dev/null; then
    echo "Repo already exists: https://github.com/${PERSONAL_USER}/${REPO_NAME}"
  else
    gh repo create "$REPO_NAME" \
      --public \
      --description "Border Chess: 10×10 iOS, Mac, and web" \
      --source "$ROOT" \
      --remote origin
    echo "Created: https://github.com/${PERSONAL_USER}/${REPO_NAME}"
  fi
  git -C "$ROOT" push -u origin main
  echo "Pushed main. Switch back: ./scripts/github-personal.sh use-primary"
}

cmd_push() {
  ensure_personal_logged_in
  switch_gh "$PERSONAL_USER"
  git -C "$ROOT" push origin main
}

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \?//'
  echo ""
  echo "Commands: status | use-personal | use-primary | create-repo | push"
}

main() {
  local cmd="${1:-status}"
  case "$cmd" in
    status) cmd_status ;;
    use-personal) cmd_use_personal ;;
    use-primary) cmd_use_primary ;;
    create-repo) cmd_create_repo ;;
    push) cmd_push ;;
    -h|--help|help) usage ;;
    *) die "Unknown command: $cmd (try --help)" ;;
  esac
}

main "$@"
