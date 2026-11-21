#!/bin/sh
# Container start-up.
#
# Migrations are applied in-process by src/db/migrate.ts, not here: that way a
# failure is a JSON log line plus a `503` on /ready instead of a container that
# exits before it can say what went wrong. `exec` keeps the server as PID 1 so
# SIGTERM reaches the graceful-shutdown path in src/ops/shutdown.ts directly.
set -eu

cd /app/apps/server

exec node_modules/.bin/tsx src/index.ts
