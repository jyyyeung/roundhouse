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

typecheck:
    pnpm typecheck

build:
    pnpm build
