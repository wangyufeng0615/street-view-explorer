#!/usr/bin/env bash
set -Eeuo pipefail

REMOTE_HOST="${REMOTE_HOST:-kr}"
REMOTE_DIR="${REMOTE_DIR:-/root/street-view-explorer}"
REMOTE_BRANCH="${REMOTE_BRANCH:-main}"
LOCAL_GIT_REMOTE="${LOCAL_GIT_REMOTE:-${GIT_REMOTE:-origin}}"
REMOTE_GIT_REMOTE="${REMOTE_GIT_REMOTE:-origin}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-240}"
PANO_SMOKE_ID="${PANO_SMOKE_ID:-does.not.exist.}"

timestamp() {
  date -Is 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z'
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
}

quote() {
  printf '%q' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$1" >&2
    exit 127
  fi
}

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

require_cmd git
require_cmd ssh

expected_commit="$(git ls-remote "$LOCAL_GIT_REMOTE" "refs/heads/$REMOTE_BRANCH" | awk '{print $1}')"
if [[ -z "$expected_commit" ]]; then
  printf 'could not resolve %s/%s; did you push the branch?\n' "$LOCAL_GIT_REMOTE" "$REMOTE_BRANCH" >&2
  exit 2
fi

local_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$local_branch" == "$REMOTE_BRANCH" ]]; then
  local_commit="$(git rev-parse HEAD)"
  if [[ "$local_commit" != "$expected_commit" ]]; then
    printf 'local %s is at %s, but %s/%s is at %s. Run git push first.\n' \
      "$REMOTE_BRANCH" "$local_commit" "$LOCAL_GIT_REMOTE" "$REMOTE_BRANCH" "$expected_commit" >&2
    exit 2
  fi
fi

log "deploying $LOCAL_GIT_REMOTE/$REMOTE_BRANCH@$expected_commit to $REMOTE_HOST:$REMOTE_DIR"

ssh "$REMOTE_HOST" \
  "REMOTE_DIR=$(quote "$REMOTE_DIR") REMOTE_BRANCH=$(quote "$REMOTE_BRANCH") REMOTE_GIT_REMOTE=$(quote "$REMOTE_GIT_REMOTE") EXPECTED_COMMIT=$(quote "$expected_commit") HEALTH_TIMEOUT=$(quote "$HEALTH_TIMEOUT") PANO_SMOKE_ID=$(quote "$PANO_SMOKE_ID") bash -s" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

timestamp() {
  date -Is 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z'
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
}

run() {
  log "+ $*"
  "$@"
}

show_failure_context() {
  local exit_code=$?
  log "remote deploy failed with exit code $exit_code"
  if command -v docker >/dev/null 2>&1 && [[ -d "${REMOTE_DIR:-}" ]]; then
    cd "$REMOTE_DIR" || return "$exit_code"
    docker compose ps || true
    docker compose logs --tail=80 backend nginx || true
  fi
  return "$exit_code"
}
trap show_failure_context ERR

cd "$REMOTE_DIR"

if [[ -n "$(git status --short --untracked-files=no)" ]]; then
  log "remote tracked files are dirty; refusing to deploy"
  git status --short --untracked-files=no
  exit 2
fi

before_commit="$(git rev-parse HEAD)"
backend_before="$(docker compose ps -q backend 2>/dev/null || true)"
nginx_before="$(docker compose ps -q nginx 2>/dev/null || true)"
backend_image_before=""
nginx_image_before=""
if [[ -n "$backend_before" ]]; then
  backend_image_before="$(docker inspect -f '{{.Image}}' "$backend_before" 2>/dev/null || true)"
fi
if [[ -n "$nginx_before" ]]; then
  nginx_image_before="$(docker inspect -f '{{.Image}}' "$nginx_before" 2>/dev/null || true)"
fi

log "remote commit before pull: $before_commit"
run git fetch "$REMOTE_GIT_REMOTE" "$REMOTE_BRANCH"
run git checkout "$REMOTE_BRANCH"
run git pull --ff-only "$REMOTE_GIT_REMOTE" "$REMOTE_BRANCH"

after_commit="$(git rev-parse HEAD)"
log "remote commit after pull: $after_commit"
if [[ "$after_commit" != "$EXPECTED_COMMIT" ]]; then
  log "expected commit $EXPECTED_COMMIT but remote is $after_commit"
  exit 2
fi

deploy_started_at="$(timestamp)"
log "starting make deploy; this can take a while on the VPS"
run make deploy
log "make deploy finished"

wait_for_service() {
  local service="$1"
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  local cid status

  while (( SECONDS < deadline )); do
    cid="$(docker compose ps -q "$service" || true)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      log "$service status: $status ($cid)"
      if [[ "$status" == "healthy" || "$status" == "running" ]]; then
        return 0
      fi
    else
      log "$service has no container yet"
    fi
    sleep 5
  done

  log "$service did not become healthy within ${HEALTH_TIMEOUT}s"
  return 1
}

wait_for_service backend
wait_for_service nginx

backend_after="$(docker compose ps -q backend)"
nginx_after="$(docker compose ps -q nginx)"
backend_image_after="$(docker inspect -f '{{.Image}}' "$backend_after")"
nginx_image_after="$(docker inspect -f '{{.Image}}' "$nginx_after")"
backend_started="$(docker inspect -f '{{.State.StartedAt}}' "$backend_after")"
nginx_started="$(docker inspect -f '{{.State.StartedAt}}' "$nginx_after")"

log "compose status"
docker compose ps

# docker compose exec inherits stdin; redirect it so it cannot consume the SSH here-doc.
log "checking backend /health from inside backend container"
docker compose exec -T backend sh -lc 'wget -qO- http://127.0.0.1:8080/health' </dev/null
printf '\n'

log "checking nginx status from inside nginx container"
docker compose exec -T nginx sh -lc 'wget -qO- http://127.0.0.1:3000/nginx_status' </dev/null >/tmp/streetview-nginx-status.txt
head -20 /tmp/streetview-nginx-status.txt

log "checking pano id validation smoke through nginx"
pano_url="http://127.0.0.1:3000/api/v1/locations/${PANO_SMOKE_ID}/description?lang=en"
pano_code="$(curl -sS --max-time 8 -o /tmp/streetview-pano-smoke.json -w '%{http_code}' "$pano_url" || true)"
pano_body="$(cat /tmp/streetview-pano-smoke.json 2>/dev/null || true)"
log "pano validation smoke status=$pano_code body=$pano_body"
if [[ "$pano_code" == "400" ]] && grep -q "无效的位置ID格式" /tmp/streetview-pano-smoke.json; then
  log "pano id with dot is still rejected by input validation"
  exit 1
fi

log "deployment summary"
printf '  commit: %s -> %s\n' "$before_commit" "$after_commit"
printf '  backend container: %s -> %s\n' "${backend_before:-none}" "$backend_after"
printf '  nginx container: %s -> %s\n' "${nginx_before:-none}" "$nginx_after"
printf '  backend image: %s -> %s\n' "${backend_image_before:-none}" "$backend_image_after"
printf '  nginx image: %s -> %s\n' "${nginx_image_before:-none}" "$nginx_image_after"
printf '  backend started: %s\n' "$backend_started"
printf '  nginx started: %s\n' "$nginx_started"
printf '  deploy started: %s\n' "$deploy_started_at"
log "remote deploy succeeded"
REMOTE_SCRIPT

log "remote deploy completed"
