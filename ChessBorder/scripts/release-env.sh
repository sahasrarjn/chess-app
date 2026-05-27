#!/usr/bin/env bash
# Shared Apple release credential helpers for ChessBorder/scripts/*.sh
# Loads repo-root .env (symlink to personal-brain/.env is fine).

chess_repo_root() {
  local script_dir="${1:?script dir}"
  cd "$script_dir/../.." && pwd
}

chess_env_file() {
  local repo
  repo="$(chess_repo_root "${1:?}")"
  if [[ -f "$repo/.env" ]]; then
    echo "$repo/.env"
    return
  fi
  if [[ -f "$repo/../personal-brain/.env" ]]; then
    echo "$repo/../personal-brain/.env"
    return
  fi
  echo "$repo/.env"
}

chess_load_env() {
  local script_dir="${1:?}"
  local env_file
  env_file="$(chess_env_file "$script_dir")"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

chess_notary_password() {
  printf '%s' "${APPLE_APP_SPECIFIC_PASSWORD:-${APPLE_NOTARY_PASSWORD:-${APP_PASSWORD:-}}}"
}

chess_notary_mode() {
  if [[ -n "${APPLE_ID:-}" && -n "${APPLE_TEAM_ID:-}" && -n "$(chess_notary_password)" ]]; then
    echo env
  elif [[ -n "${APPLE_NOTARY_PROFILE:-}" ]]; then
    echo keychain
  fi
}

chess_require_developer_id() {
  if [[ -z "${DEVELOPER_ID:-}" ]]; then
    echo "FATAL: missing DEVELOPER_ID in .env" >&2
    exit 1
  fi
}

chess_notary_submit() {
  local artifact="$1"
  if [[ "$(chess_notary_mode)" == env ]]; then
    xcrun notarytool submit "$artifact" \
      --apple-id "$APPLE_ID" \
      --team-id "$APPLE_TEAM_ID" \
      --password "$(chess_notary_password)" \
      --wait
  else
    xcrun notarytool submit "$artifact" \
      --keychain-profile "$APPLE_NOTARY_PROFILE" \
      --wait
  fi
}

chess_require_aws_publish() {
  command -v aws >/dev/null || { echo "FATAL: aws CLI required" >&2; exit 1; }
}
