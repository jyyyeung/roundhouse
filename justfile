set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
set dotenv-load := true

default:
    @just --list

# Enable corepack (if present), install deps, ensure .env for hybrid local dev
setup:
    @if command -v corepack >/dev/null; then corepack enable; \
    elif ! command -v pnpm >/dev/null; then \
      echo 'Need pnpm (corepack missing). Install: https://pnpm.io/installation'; exit 1; \
    fi
    pnpm install
    @if [ ! -f .env ]; then \
      cp .env.example .env; \
      sed -i.bak \
        -e 's|@db:5432|@localhost:5432|' \
        -e 's|^BETTER_AUTH_URL=.*|BETTER_AUTH_URL=http://localhost:3001|' \
        -e 's|^PUBLIC_WEB_URL=.*|PUBLIC_WEB_URL=http://localhost:5173|' \
        .env && rm -f .env.bak; \
      echo 'VITE_API_URL=http://localhost:3001' >> .env; \
      echo 'Created .env for hybrid local dev (localhost Postgres, Vite on :5173).'; \
    else \
      echo '.env already exists — left untouched.'; \
    fi

# Postgres only (Compose)
db:
    docker compose up -d db
    @echo 'Waiting for Postgres...'
    @until docker compose exec -T db pg_isready -U roundhouse -d roundhouse >/dev/null 2>&1; do sleep 0.5; done

db-down:
    docker compose stop db

db-reset:
    docker compose down -v
    just db

# Dump the running database into backups/ (Postgres custom format, so
# `just restore` can read it). Safe to run while players are connected.
backup:
    @mkdir -p backups
    @stamp=$(date -u +%Y%m%dT%H%M%SZ); \
      dump="backups/roundhouse-$stamp.dump"; \
      docker compose exec -T db pg_dump -U "${POSTGRES_USER:-roundhouse}" -d "${POSTGRES_DB:-roundhouse}" -Fc > "$dump"; \
      echo "backup: wrote $dump ($(du -h "$dump" | cut -f1))"

# Restore a dump produced by `just backup`. The server is stopped first so
# nothing writes while the schema is replaced, and started again afterwards —
# including when the restore fails.
restore file:
    @if [ ! -f "{{file}}" ]; then echo "restore: no such dump: {{file}}" >&2; exit 1; fi
    docker compose stop server
    @trap 'docker compose start server' EXIT; \
      docker compose exec -T db pg_restore -U "${POSTGRES_USER:-roundhouse}" -d "${POSTGRES_DB:-roundhouse}" --clean --if-exists --no-owner < "{{file}}"; \
      echo "restore: wrote {{file}} back into ${POSTGRES_DB:-roundhouse}"

# Hybrid: Compose Postgres + local pnpm apps (run `just setup` once first)
dev: db
    @if [ ! -f .env ]; then just setup; fi
    pnpm --filter @roundhouse/server db:migrate
    pnpm dev

# Full Compose stack (web on :8080)
up:
    @if [ ! -f .env ]; then cp .env.example .env; fi
    docker compose up --build -d

down:
    docker compose down

down-v:
    docker compose down -v

logs *service:
    docker compose logs -f {{service}}

migrate:
    pnpm --filter @roundhouse/server db:migrate

test:
    pnpm test

# Integration suite: runs the real migrations and SQL, so it needs a throwaway
# database whose name ends in _test (create it once):
#   docker compose exec -T db createdb -U roundhouse roundhouse_test
test-integration:
    DATABASE_URL_TEST=postgres://roundhouse:roundhouse@localhost:5432/roundhouse_test \
      pnpm test:integration

typecheck:
    pnpm typecheck

# Lint + format + import order, one tool (Biome). CI runs this exact command.
lint:
    pnpm lint

format:
    pnpm format

# Invariant I1: stored module state is projected in exactly one place (ADR 0001)
check-projection:
    pnpm check:projection

# Every variable the app reads is in docs/self-hosting.md and .env.example.
# The script is unit-tested against a fixture, so it cannot rot silently.
check-env-docs:
    pnpm check:env-docs

# Parse the TLS samples in docs/deploy (Caddyfile + nginx) in their real images
# without owning a certificate. Needs docker.
check-deploy-samples:
    ./scripts/check-deploy-samples.sh

# Build both images and run the packaged stack on throwaway ports (:3101/:8180),
# then tear it down. The only check that exercises the Dockerfiles and nginx.
compose-smoke:
    ./scripts/compose-smoke.sh

# End-to-end smoke test against a running server. Override SMOKE_BASE_URL /
# SMOKE_WEB_ORIGIN for a Compose stack (web on :8080).
smoke:
    node scripts/smoke.mjs

build:
    pnpm build
