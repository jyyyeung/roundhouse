# Operations

What the server promises about its own health, its logs, and its exit path, and
how to check each promise without reading the source.

## Probes

| Path          | Answers                        | Reads a dependency          | Used by                                           |
| ------------- | ------------------------------ | --------------------------- | ------------------------------------------------- |
| `GET /health` | is the process alive           | no                          | the image `HEALTHCHECK`, container restart policy |
| `GET /ready`  | can this process serve traffic | yes — Postgres + migrations | Compose (`web` waits for it), a deploy gate       |

`/health` is deliberately I/O free. Restarting a process because Postgres is down
turns a database outage into a crash loop and loses the websocket sessions that
would have survived. `/ready` is the probe that is allowed to fail.

`/ready` answers within one second: each check gets `READY_TIMEOUT_MS` and the
checks run concurrently, so a hung database produces `503` with a reason instead
of hanging the probe until the orchestrator gives up.

```console
$ curl -s localhost:3001/ready | jq
{
  "ok": false,
  "checks": [
    { "name": "database", "ok": false, "durationMs": 1001, "reason": "did not finish within 1000ms" },
    { "name": "migrations", "ok": false, "durationMs": 1000, "reason": "did not finish within 1000ms" }
  ]
}
```

The `migrations` check compares the `.sql` files in `apps/server/drizzle/` with
`drizzle.__drizzle_migrations`, so an image that is newer than the database fails
readiness instead of serving requests against a stale schema.

## Logs

One JSON object per line on stdout, one event per line, no wrapped arrays:

```json
{"level":"info","time":"2026-01-01T00:00:00.000Z","msg":"server.listening","component":"api","port":3001,"version":2}
{"level":"warn","time":"2026-01-01T00:00:01.000Z","msg":"ws.bad_message","component":"ws.hub","code":"bad_message","connectionId":"8f1c…","tableId":"t_123"}
```

Fields you can rely on:

- `level` — `debug`, `info`, `warn`, `error`; set the floor with `LOG_LEVEL`.
- `msg` — a stable event name (`server.listening`, `http.request`,
  `ws.intent_applied`, `chat.persist_failed`, `ready.check_failed`,
  `shutdown.done`, …), not a sentence. Grep on it.
- `requestId` — echoed in the `x-request-id` response header; one per HTTP request.
- `connectionId` — one per websocket, so a connection's frames can be followed
  across reconnects.
- `tableId`, `actionId`, `code`, `durationMs` where they apply.

`Error` values are unwrapped to `{name, message, stack}` instead of `{}`, because
`JSON.stringify(new Error("x"))` is `{}` and a log line that says nothing is worse
than no line at all. The logger never imports the env schema: it has to work when
env validation fails, so it reads `LOG_LEVEL` straight from `process.env` and falls
back to `info`.

Chat text and player names are never logged.

## Shutdown

`SIGTERM` / `SIGINT` start a bounded, ordered shutdown:

1. `http` — stop accepting connections, close idle keep-alive sockets, and cut
   anything still mid-request after two seconds.
2. `ws` — close every socket with code `1012` (`service restart`) and reason
   `server_restart`, which the web client reads as "reconnect now" instead of
   backing off.
3. `db` — `client.end({ timeout })`, so a connection stuck in a query cannot hold
   the process open.

The whole sequence shares a 5-second budget. A step that throws is logged and the
next one runs; once one step eats the budget, the rest are reported as
`deadline_exceeded` rather than started. `shutdown.done` carries the per-step
timings, and the process exits `0` — a planned restart is not a failure.

`docker compose stop server` is the end-to-end check: the log shows
`shutdown.start` … `shutdown.done`, and a connected client receives the close
frame and reconnects on its own.

## Server image

`apps/server/Dockerfile` is two stages on the same `node:22-alpine` base:

- `deps` installs production dependencies only (`pnpm install --prod --filter
  "@roundhouse/server..."`), which drops every test tool from the image.
- `runtime` copies that `node_modules` tree, the pnpm home, and the sources, then
  runs as the unprivileged `node` user.

The server runs its TypeScript sources with `tsx` in production rather than
compiling: workspace packages resolve to `src/index.ts`, so compiling the server
alone would emit imports of TypeScript files. `tsx` is therefore a production
dependency; `drizzle-kit` is not, because migrations are applied in process
(`apps/server/src/db/migrate.ts`) before the listener opens. A migration failure
is logged as `migrate.failed` and start-up continues, so a database that is down
or behind shows up as a `503` on `/ready` instead of a container that exits and
restarts before it can say why. The new image is 325 MB against 911 MB for the
single-stage one it replaced.

The image `HEALTHCHECK` asks `/health`; Compose overrides it with `/ready` so
`web` does not start before the API can reach the database.

## Failure drills

Run these against `docker compose up`. Each one is also what the acceptance
criteria for M0-8 asked for.

| Drill                                                | Expect                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `docker compose stop db`                             | `/health` still `200`; `/ready` `503` within ~1s with `database` failing; live games survive |
| `docker compose start db`                            | `/ready` back to `200` without restarting the server                                         |
| `docker compose stop server` with a client connected | client gets close `1012 server_restart`, reconnects at once, no error banner                 |
| kill -TERM the server                                | `shutdown.*` lines, exit `0`, no truncated HTTP response                                     |
| run the server image with a wrong `DATABASE_URL`     | starts, `server.listening`, `/ready` `503` — a broken dependency is visible, not fatal       |
