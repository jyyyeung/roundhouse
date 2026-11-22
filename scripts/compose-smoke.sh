#!/usr/bin/env bash
#
# Compose smoke: build both images, start the stack, prove the API and the web
# tier answer, then tear everything down.
#
# This is the only check that exercises the *packaged* application: the Docker
# images, the nginx proxy, the migrations the server runs on boot, and the
# composition of all three services. Unit tests and `scripts/smoke.mjs` against a
# dev server cannot see a broken Dockerfile.
#
# The stack runs under its own compose project name on throwaway host ports, so it
# can run next to a developer's `just up` without touching it. The database volume
# is removed on exit, and logs are dumped when something fails.
set -euo pipefail

cd "$(dirname "$0")/.."

project="${COMPOSE_SMOKE_PROJECT:-roundhouse-smoke}"
server_port="${COMPOSE_SMOKE_SERVER_PORT:-3101}"
web_port="${COMPOSE_SMOKE_WEB_PORT:-8180}"
db_port="${COMPOSE_SMOKE_DB_PORT:-5499}"
api_origin="http://localhost:${server_port}"
web_origin="http://localhost:${web_port}"

# Everything the compose file would otherwise interpolate from a developer's
# .env is set explicitly here: the smoke run must not inherit local secrets or a
# PUBLIC_WEB_URL that points at :8080.
export DB_PORT="$db_port"
export SERVER_PORT="$server_port"
export WEB_PORT="$web_port"
export BETTER_AUTH_URL="$web_origin"
export PUBLIC_WEB_URL="$web_origin"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-compose-smoke-secret-0123456789abcdef}"

compose() {
  docker compose --project-name "$project" --env-file /dev/null "$@"
}

# Fail on a port clash before a five minute image build, and say which knob turns.
for spec in "db:$db_port:COMPOSE_SMOKE_DB_PORT" \
  "api:$server_port:COMPOSE_SMOKE_SERVER_PORT" \
  "web:$web_port:COMPOSE_SMOKE_WEB_PORT"; do
  label="${spec%%:*}"
  rest="${spec#*:}"
  port="${rest%%:*}"
  knob="${rest##*:}"
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    exec 3>&- 2>/dev/null || true
    echo "compose smoke: port $port ($label) is already in use — set $knob to a free port" >&2
    exit 1
  fi
done

log_file=""
log_pid=""

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- compose logs (tail) ---"
    compose logs --no-color --tail=200 || true
  fi
  if [ -n "$log_pid" ]; then
    kill "$log_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "$log_file" ]; then
    rm -f "$log_file"
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

echo "compose smoke: project=$project api=$api_origin web=$web_origin db=:$db_port"
compose up --build --detach --wait --wait-timeout 300

# The default mail transporter logs each message instead of mailing it, so the
# packaged stack can prove account recovery without an SMTP server: follow the
# server's stdout and let smoke.mjs read the reset link out of it.
log_file="$(mktemp)"
compose logs --follow --no-color --since 1s server >"$log_file" 2>&1 &
log_pid=$!

node scripts/wait-for-url.mjs "$api_origin/health" "api /health" --expect '"ok"' --timeout 120000
node scripts/wait-for-url.mjs "$web_origin/" "web root" --expect '<div id="root">' --timeout 60000

# The full end-to-end script, now against the packaged stack rather than a dev
# server: auth cookies, table creation, a WebSocket upgrade and a game start.
SMOKE_BASE_URL="$api_origin" SMOKE_WEB_ORIGIN="$web_origin" SMOKE_SERVER_LOG="$log_file" \
  node scripts/smoke.mjs

echo "compose smoke: ok"
