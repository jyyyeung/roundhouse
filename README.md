# Roundhouse

Remote table games for friends — live rooms, chat with game context, pluggable game modules. Two
titles: **Yatzy/Yahtzee** (dice, turn-based) and **Duel** (simultaneous secret picks, hidden
information).

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
3. Check health: `curl -sf http://localhost:3001/health` and readiness: `curl -sf http://localhost:3001/ready`
4. Open the app at `http://localhost:8080`

Compose starts:

- `db`: Postgres 16 with a persistent `postgres-data` volume
- `server`: applies pending migrations in process, then starts the API/websocket server; it reports readiness on `/ready` and Compose waits for that before starting `web`
- `web`: serves the Vite build from nginx and proxies `/api`, `/ws`, `/health` and `/ready` to the server container

To stop the stack, run `docker compose down`. Add `-v` if you also want to remove the Postgres volume (needed after DB name/user defaults change).

Deploying this on a real machine — TLS in front, backups, upgrades, every setting explained —
is [`docs/self-hosting.md`](docs/self-hosting.md).

## Tests

- `pnpm test` — unit suites for every package. No database, no network; fast enough to run on save.
- `just test-integration` — `apps/server/src/room/runtime.integration.test.ts` against real Postgres (concurrent joins, concurrent intents, every `TablesError` code, per-viewer projection). It refuses to run unless `DATABASE_URL_TEST` names a database ending in `_test`, because it truncates every table between tests. Create it once:
  `docker compose exec -T db createdb -U roundhouse roundhouse_test`
- `just check-projection` — the contract guard: module state is projected in exactly one place (invariant I1) and platform code names no specific game.
- `just check-env-docs` — every variable the app reads appears in `docs/self-hosting.md` and `.env.example`. The guard is itself unit-tested against a fixture (`pnpm test:scripts`), so a silently broken scan fails.
- `just check-deploy-samples` — parses the Caddy and nginx TLS samples in their real images against a throwaway certificate, so a sample that cannot boot fails here instead of on a self-hoster's box.
- `just smoke` — end-to-end run against a started server (`scripts/smoke.mjs`).
- `just compose-smoke` — builds both Docker images, boots the packaged stack on throwaway ports, checks `/health` and `/ready`, the web root, and the end-to-end script, then tears it down and removes the volume.
- `just backup` / `just restore <file>` — dump the running database into `backups/` and put it back. The restore stops the server first and starts it again even if the restore fails; [`docs/self-hosting.md`](docs/self-hosting.md#backup-and-restore) has the cron line and the verify steps.
- `pnpm lint` / `pnpm format` — Biome does linting, formatting, and import order in one pass. `pnpm lint:fix` writes fixes; CI fails on `pnpm lint` and `pnpm format:check`.

## Replays

A finished game can be watched back one step at a time. The server folds the stored event log with
the game's own `applyEvent`, projects each step for the viewer, and serves it from
`GET /api/tables/:id/replay`; the page at `/t/:tableId/replay` scrubs those projections with the
normal game view in read-only mode. Entry points are the "Watch the replay" button on a finished
table and the replay button on a finished row in the lobby. Event payloads never cross the wire —
see [ADR 0009](docs/adr/0009-replay-is-a-projection.md) for why that is the whole design.

## Adding a game

`docs/adding-a-game.md` is the walkthrough: a package under `packages/games/<id>/` declaring
`playerCount`, `defaultConfig` and `configSchema` plus a `GameModule`, one line in
`apps/server/src/modules/registry.ts`, one entry in `apps/web/src/games/registry.tsx`. Optionally implement `describeEvent(event)` to give each recorded
action a human phrase in a replay (`null` means "not a step"); without it a step is titled with the
event type. The lobby, the
`/api/games` catalogue and the table route pick it up with no further edits — see
[ADR 0004](docs/adr/0004-games-are-data.md) for why the platform is not allowed to branch per game,
and [ADR 0005](docs/adr/0005-secrets-enter-the-log-at-the-reveal.md) for how a game keeps a secret
off the wire (Duel is the worked example).

## Operations

`docs/ops.md` is the full story for a running server; [`docs/self-hosting.md`](docs/self-hosting.md) covers standing one up, backing it up and upgrading it. The short version:

- `GET /health` is process liveness (no I/O) and `GET /ready` checks Postgres plus
  pending migrations, answering `503` within a second when either is unhappy.
- Logs are one JSON object per line on stdout (`LOG_LEVEL` sets the floor), keyed by
  `msg` event name, with `requestId` per HTTP request and `connectionId` per socket.
- `SIGTERM`/`SIGINT` close sockets with `1012 server_restart` (the web client
  reconnects immediately), then the pool, all inside a 5-second budget.
- The server image builds in two stages, installs production dependencies only, and
  runs as `node`, not root.
- Inputs are rate limited: intents and chat per player per table, password and
  mail routes per address. Limits live in environment variables
  (`INTENT_RATE_LIMIT`, `CHAT_RATE_LIMIT`, `AUTH_RATE_LIMIT`, …), a refused intent
  answers `rate_limited` with `retryAfterMs` and writes nothing, and the counters
  are **per process** — correct for one container, doubled by a second replica.
  `TRUST_PROXY` decides whether `x-forwarded-for` counts; the bundled nginx
  overwrites it, so each browser gets its own auth budget. See
  [`docs/ops.md`](docs/ops.md#rate-limits) and
  [ADR 0007](docs/adr/0007-limits-are-per-process.md).
- Account recovery works without a mail provider: `MAIL_TRANSPORT=log` (the
  default) writes each message to stdout, `smtp` needs `MAIL_SMTP_URL`, and
  `MAIL_FROM` sets the sender. Reset links are single use, expire in an hour, and
  a successful reset signs out existing sessions.
  `AUTH_REQUIRE_VERIFICATION=true` refuses sign-in until the address is
  confirmed and blocks creating or joining tables first; Google sign-in appears
  only when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are both set, because the
  sign-in page asks `GET /api/auth/providers`. See
  [ADR 0008](docs/adr/0008-mail-is-a-port.md).
- `just backup` writes a custom-format dump into `backups/`; `just restore <file>` stops the
  server, replaces the schema and starts it again. Dumps contain accounts and sessions, so
  `backups/` is gitignored — treat a copy like a password file.

## CI

Every push to `main` and every pull request runs four workflows:

| workflow            | what it proves                                                                        |
| ------------------- | ------------------------------------------------------------------------------------- |
| `ci.yml`            | typecheck, lint, format, unit tests, and a production build                           |
| `integration.yml`   | the room runtime against a real `postgres:16` (races, locks, migrations)              |
| `compose-smoke.yml` | the Docker images and nginx serve a working stack, and the TLS samples parse          |
| `contracts.yml`     | the projection guard (invariant I1) and the env-docs guard (every setting documented) |

`main` is protected: the five checks above are required, changes land through a pull
request, and force-pushes are disabled.

```sh
git switch -c my-change
git commit -am "feat: something"
git push -u origin my-change
gh pr create --fill
gh pr merge --squash --delete-branch   # once the checks are green
```
