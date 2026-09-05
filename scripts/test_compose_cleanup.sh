#!/usr/bin/env bash
set -euo pipefail

# Exercise the real Make targets in a disposable Compose project. Never load
# the application Compose file, production volumes or any .env credentials.
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/streetview-cleanup.XXXXXXXX")"
project="$(basename "$test_dir" | tr '[:upper:].' '[:lower:]-')"
fixture="$root_dir/scripts/fixtures/cleanup-compose.yml"
compose=(docker compose --project-name "$project" --project-directory "$test_dir" -f "$fixture")
volume="${project}_sqlite_data"
cleanup() {
  "${compose[@]}" down -v >/dev/null
  rmdir "$test_dir"
}
trap cleanup EXIT

"${compose[@]}" up -d --wait
"${compose[@]}" exec -T sentinel sh -c 'printf "retained\n" > /data/sentinel'
printf -v compose_command '%q ' "${compose[@]}"

if make -C "$test_dir" -f "$root_dir/Makefile" destroy-data COMPOSE="$compose_command"; then
  echo 'destroy-data unexpectedly accepted missing confirmation' >&2
  exit 1
fi
"${compose[@]}" exec -T sentinel test -f /data/sentinel
make -C "$test_dir" -f "$root_dir/Makefile" clean COMPOSE="$compose_command"
docker volume inspect "$volume" >/dev/null
test -z "$("${compose[@]}" ps --all --quiet)"
"${compose[@]}" up -d --wait
test "$("${compose[@]}" exec -T sentinel cat /data/sentinel)" = retained
make -C "$test_dir" -f "$root_dir/Makefile" destroy-data CONFIRM_DELETE_DATA=yes COMPOSE="$compose_command"
if docker volume inspect "$volume" >/dev/null 2>&1; then
  echo 'destroy-data did not remove the disposable volume' >&2
  exit 1
fi
echo 'Compose cleanup passed: refusal, container removal, data retention, restart and explicit deletion'
