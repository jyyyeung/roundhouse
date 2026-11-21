# Roundhouse

Remote table games for friends — live rooms, chat with game context, pluggable modules (Yatzy/Yahtzee first).

[![ci](https://github.com/jyyyeung/roundhouse/actions/workflows/ci.yml/badge.svg)](https://github.com/jyyyeung/roundhouse/actions/workflows/ci.yml)

## Local dev

1. Enable pnpm via Corepack: `corepack enable`
2. Install deps: `pnpm install`
3. Copy envs: `cp .env.example .env`
4. If you're running Postgres outside Docker, change `DATABASE_URL` in `.env` from `db` to `localhost`
5. Start the apps: `pnpm dev`

The web app runs on `http://localhost:5173` and the server health endpoint is `http://localhost:3001/health`.

## Docker Compose

1. Optional: `cp .env.example .env` if you want to override defaults
2. Start the stack: `docker compose up --build -d`
3. Check health: `curl -sf http://localhost:3001/health`
4. Open the app at `http://localhost:8080`

Compose starts:

- `db`: Postgres 16 with a persistent `postgres-data` volume
- `server`: runs `pnpm --filter @roundhouse/server db:migrate` before starting the API/websocket server
- `web`: serves the Vite build from nginx and proxies `/api` plus `/ws` to the server container

To stop the stack, run `docker compose down`. Add `-v` if you also want to remove the Postgres volume (needed after DB name/user defaults change).

## Tests

- `pnpm test` — unit suites for every package. No database, no network; fast enough to run on save.
- `just test-integration` — `apps/server/src/room/runtime.integration.test.ts` against real Postgres (concurrent joins, concurrent intents, every `TablesError` code, per-viewer projection). It refuses to run unless `DATABASE_URL_TEST` names a database ending in `_test`, because it truncates every table between tests. Create it once:
  `docker compose exec -T db createdb -U roundhouse roundhouse_test`
- `just check-projection` — enforces that module state is projected in exactly one place (invariant I1).
- `just smoke` — end-to-end run against a started server (`scripts/smoke.mjs`).
- `just compose-smoke` — builds both Docker images, boots the packaged stack on throwaway ports, checks `/health`, the web root, and the end-to-end script, then tears it down and removes the volume.
- `pnpm lint` / `pnpm format` — Biome does linting, formatting, and import order in one pass. `pnpm lint:fix` writes fixes; CI fails on `pnpm lint` and `pnpm format:check`.

## CI

Every push to `main` and every pull request runs four workflows:

| workflow            | what it proves                                                           |
| ------------------- | ------------------------------------------------------------------------ |
| `ci.yml`            | typecheck, lint, format, unit tests, and a production build              |
| `integration.yml`   | the room runtime against a real `postgres:16` (races, locks, migrations) |
| `compose-smoke.yml` | the Docker images and nginx actually serve a working stack               |
| `contracts.yml`     | the projection guard (invariant I1)                                      |

`main` is protected: the five checks above are required, changes land through a pull
request, and force-pushes are disabled.

```sh
git switch -c my-change
git commit -am "feat: something"
git push -u origin my-change
gh pr create --fill
gh pr merge --squash --delete-branch   # once the checks are green
```
