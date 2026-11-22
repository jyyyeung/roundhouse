# Self-hosting Roundhouse

Roundhouse is one Postgres database, one API/WebSocket server, and one nginx
container serving a static build. Everything below is done with Docker Compose;
there is no separate database migration service, no message queue, and no worker.

If you only want to click around your laptop, the README's quickstart is shorter.
This document is for the person who keeps the box alive.

- [Prerequisites](#prerequisites)
- [Five-minute install](#five-minute-install)
- [Settings reference](#settings-reference)
- [Compose settings](#compose-settings)
- [Health and monitoring](#health-and-monitoring)
- [Backup and restore](#backup-and-restore)
- [Upgrading](#upgrading)
- [TLS in front](#tls-in-front)
- [Troubleshooting by symptom](#troubleshooting-by-symptom)

## Prerequisites

- Docker Engine 24+ with the Compose v2 plugin (`docker compose version`).
- 1 vCPU, 1 GB RAM, 2 GB disk. The database grows by roughly a kilobyte per
  game action, so a friends-and-family server stays small for a long time.
- A hostname with a DNS record pointing at the box, if anyone outside your
  network will use it. The sign-in flow uses cookies, so plain HTTP works only
  on `localhost`.
- Ports 80 and 443 free if you follow the TLS section, or 8080 only if you are
  keeping it on a LAN.

Node and pnpm are **not** needed on the server. They are needed only if you are
hacking on the code; the Dockerfiles build everything themselves.

## Five-minute install

```sh
git clone https://github.com/jyyyeung/roundhouse.git
cd roundhouse
cp .env.example .env
```

Open `.env` and change three things:

1. `BETTER_AUTH_SECRET` — at least 32 characters, random, and never reused:
   `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`.
2. `BETTER_AUTH_URL` — the address browsers use, e.g. `https://table.example.com`.
3. `PUBLIC_WEB_URL` — the same address. It is the trusted origin for auth and the
   host in every mail link.

Then:

```sh
docker compose up --build -d
docker compose ps
```

`server` must reach `(healthy)`, not `(health: starting)`, before `web` starts —
Compose enforces that ordering. Verify:

```sh
curl -sf http://localhost:8080/health   # {"ok":true,"uptimeSeconds":12}
curl -sf http://localhost:8080/ready    # {"ok":true,"checks":[...]}
```

Open `http://localhost:8080` (or your hostname), create an account, and the app
is running. Databases are created and migrated automatically on first start.

**What you are trusting.** The default `.env.example` is a working local set of
values, not a secure public one: it uses the compose-internal database password,
the log mail transport, and no Google client. The three edits above are the
minimum for a public deployment; the reference table below says what the rest
do.

## Settings reference

The server validates this list at boot with zod and refuses to start on a value
it cannot use. `scripts/check-env-docs.mjs` (run by `just check-env-docs` and in
CI) fails when a variable exists in code but not in this table or in
`.env.example`, so this list cannot drift.

| Variable                    | Default                                               | What it does / what breaks if wrong                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | `postgres://roundhouse:roundhouse@db:5432/roundhouse` | Postgres connection string. Inside Compose the host is `db`; on a host-run dev server it is `localhost`. Wrong: boot fails or `/ready` reports the `database` check failing.                                                                |
| `BETTER_AUTH_SECRET`        | `change-me-to-a-32+char-secret-value`                 | Signs sessions and verification tokens. At least 32 characters. Changing it signs every player out and invalidates outstanding verification links; losing it cannot be recovered.                                                           |
| `BETTER_AUTH_URL`           | `http://localhost:8080`                               | Public API origin used for auth URLs and callback building. Must match the scheme and host players actually reach, or sign-in redirects land on the wrong origin.                                                                           |
| `PUBLIC_WEB_URL`            | `http://localhost:8080`                               | The web origin: trusted origin for auth requests and the host in reset/verification mail links. Mismatched → `Invalid origin` on sign-in, mail links that point nowhere.                                                                    |
| `PORT`                      | `3001`                                                | Port the API listens on inside its container. Compose maps `SERVER_PORT` to it; change this only if you changed both.                                                                                                                       |
| `LOG_LEVEL`                 | `info`                                                | `debug`, `info`, `warn` or `error`. One JSON object per line on stdout. An unparseable value falls back to `info` rather than crashing, because logging must survive a broken environment.                                                  |
| `INTENT_RATE_LIMIT`         | `20`                                                  | Game actions one player may send to one table per window. Generous for a human, fends off a client stuck in a retry loop. Too low → normal play is throttled with `rate_limited`.                                                           |
| `INTENT_RATE_WINDOW_MS`     | `10000`                                               | Window for the above, in milliseconds.                                                                                                                                                                                                      |
| `CHAT_RATE_LIMIT`           | `5`                                                   | Chat messages one player may send to one table per window.                                                                                                                                                                                  |
| `CHAT_RATE_WINDOW_MS`       | `10000`                                               | Window for the above, in milliseconds.                                                                                                                                                                                                      |
| `AUTH_RATE_LIMIT`           | `10`                                                  | Auth attempts per client address per route per window (sign-in, sign-up, password reset).                                                                                                                                                   |
| `AUTH_RATE_WINDOW_SECONDS`  | `60`                                                  | Window for the above, in seconds.                                                                                                                                                                                                           |
| `TRUST_PROXY`               | unset (false)                                         | `true` or `1` when a reverse proxy in front sets `X-Forwarded-For` (the bundled nginx overwrites it with the real client address). Unset means the socket address is used, so **every** player behind a proxy shares one rate-limit bucket. |
| `MAIL_TRANSPORT`            | `log`                                                 | `log` writes each message to stdout — no mail server needed, and the reset link is visible in `docker compose logs server`. `smtp` sends for real and requires `MAIL_SMTP_URL`; the server refuses to boot with `smtp` and no URL.          |
| `MAIL_FROM`                 | `Roundhouse <no-reply@roundhouse.local>`              | Envelope sender. Most SMTP providers reject a domain you have not verified, so change it when you turn SMTP on.                                                                                                                             |
| `MAIL_SMTP_URL`             | unset                                                 | Full SMTP URL, e.g. `smtp://user:pass@smtp.example.com:587`. Required by `MAIL_TRANSPORT=smtp`.                                                                                                                                             |
| `AUTH_REQUIRE_VERIFICATION` | unset (false)                                         | `true` refuses sign-in until the address is confirmed, and blocks creating or joining a table (`needs_verify`) until then. Turn it on for anything public: it is what makes password recovery prove the address belongs to the player.      |
| `GOOGLE_CLIENT_ID`          | unset                                                 | With `GOOGLE_CLIENT_SECRET`, enables "Continue with Google". Half a pair refuses to boot; both unset means the sign-in page draws no Google button at all.                                                                                  |
| `GOOGLE_CLIENT_SECRET`      | unset                                                 | The other half. In the Google console the redirect URI is `<BETTER_AUTH_URL>/api/auth/callback/google`.                                                                                                                                     |
| `VITE_API_URL`              | unset (same origin)                                   | Web build-time setting: absolute API base. Leave empty in Compose so the browser talks to the same origin nginx serves and proxies `/api` and `/ws`. Baked in at build time — changing it needs a `--build`, not a restart.                 |

Rate limits are held in process memory. One container is correct; two replicas
double every budget. See [ADR 0007](adr/0007-limits-are-per-process.md).

## Compose settings

These are read by `docker-compose.yml`, not by the app, so they live in `.env`
(or the shell) but not in `.env.example`'s app section:

| Variable            | Default      | What it does                                                                                                       |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `WEB_PORT`          | `8080`       | Host port for the nginx container.                                                                                 |
| `SERVER_PORT`       | `3001`       | Host port for the API. Needed only for debugging; the web container proxies `/api`, `/ws`, `/health` and `/ready`. |
| `DB_PORT`           | `5432`       | Host port for Postgres, for `psql` from the host.                                                                  |
| `POSTGRES_DB`       | `roundhouse` | Database name on first boot. Changing it later leaves data in the old database — `just down-v` or restore instead. |
| `POSTGRES_USER`     | `roundhouse` | Database user on first boot.                                                                                       |
| `POSTGRES_PASSWORD` | `roundhouse` | Database password on first boot. If you change it, change `DATABASE_URL` to match, or the server cannot connect.   |

`POSTGRES_*` take effect only when the volume is created. An existing volume
keeps its credentials no matter what the environment says — the classic symptom
is a server that suddenly cannot authenticate after someone edited `.env`.

## Health and monitoring

Two endpoints, deliberately different:

- `GET /health` — is the process alive? It does no I/O and cannot fail while the
  process can answer. Point a **restart** watchdog at this, if anything.
- `GET /ready` — should this process receive traffic? It checks Postgres and
  whether every migration this build ships has been applied, each under a
  one-second deadline, and answers `200` or `503`.

Both are proxied through the web container, so a monitor behind TLS only needs
the public port:

```sh
curl -sf https://table.example.com/health
curl -sf https://table.example.com/ready
```

A `503` body names the failing check and the reason, which is the point of the
endpoint:

```json
{
  "ok": false,
  "checks": [
    {
      "name": "database",
      "ok": false,
      "durationMs": 1000,
      "reason": "deadline exceeded after 1000ms"
    },
    { "name": "migrations", "ok": true, "durationMs": 1.2 }
  ]
}
```

Alert on `/ready` failing for more than a minute; `/health` failing means the
process is gone and the restart policy is already handling it. Logs are one JSON
object per line on stdout (`docker compose logs -f server`); [`docs/ops.md`](ops.md)
describes the fields and the shutdown behaviour.

## Backup and restore

Everything that matters is in the database: accounts, sessions, tables, seats,
the event log, and chat. Uploaded files do not exist. The one thing **not** in
the dump is `BETTER_AUTH_SECRET`: restore a dump without the matching secret and
every account still exists but every session is invalid and outstanding
verification links stop working. It is a password, so keep it in your password
manager next to the DNS login.

Backup is a command:

```sh
just backup
# wrote backups/roundhouse-20260101T030000Z.dump (212K)
```

It runs `pg_dump -Fc` against the running `db` service and writes a timestamped
custom-format dump into `backups/`. Copy it off the box; a backup on the same
disk as the database is not a backup. A nightly cron entry is enough:

```cron
0 3 * * * cd /srv/roundhouse && just backup && rclone copy backups/ remote:roundhouse-backups
```

Restore is also a command, and it is destructive by design:

```sh
just restore backups/roundhouse-20260101T030000Z.dump
```

The recipe stops the `server` container (so no request is mid-write), runs
`pg_restore --clean --if-exists` into the same database, and starts the server
again. `--clean` drops what is there, which is what "restore" means. The dump
includes Drizzle's migration table, so `/ready` agrees with the restored schema
immediately.

Verify a restore instead of assuming it:

1. `curl -sf https://table.example.com/ready` → `{"ok":true,...}`.
2. Sign in with an account created before the dump.
3. Open a table that was mid-game when you dumped: cards, dice and scores come
   back, because they are rows, not process memory.
4. If verification is on, remember outstanding links were signed with the secret
   that was current when they were mailed.

## Upgrading

```sh
git pull
docker compose build
docker compose up -d
```

Order matters and Compose handles it: `db` becomes healthy, then `server` starts,
applies pending migrations **before** it opens its listener
(`apps/server/src/index.ts`), reports healthy on `/ready`, and only then does
`web` start. There is no window where a browser reaches an API pointed at an
unmigrated schema.

That ordering is not a promise in a document: `just compose-smoke` builds the images, starts the
packaged stack on an empty volume and fails unless the server logged `migrate.done` before
`server.listening`. If a future change moves migrations after the listener, CI catches it here
before an upgrade can reintroduce the window.

Rolling back is a restore, not a downgrade: migrations are forward-only and
there are no `down` migrations. Before an upgrade that might matter, take one:

```sh
just backup
```

Then, if the new version is wrong for you: `git checkout <previous tag>`,
rebuild, and restore the dump from before the upgrade.

## TLS in front

Two samples, both terminating TLS and proxying the whole origin to the `web`
container, which already forwards `/api`, `/ws`, `/health` and `/ready` to the
server. Copy the one that matches the proxy you already run; both are parsed in
CI by `just check-deploy-samples`.

**Caddy** — [`docs/deploy/Caddyfile`](deploy/Caddyfile). Certificates are
automatic; this is the shortest correct path:

```sh
cp docs/deploy/Caddyfile /etc/caddy/Caddyfile   # then replace the hostname
docker run -d --name roundhouse-caddy --restart unless-stopped \
  --network roundhouse_default \
  -v /etc/caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v caddy-data:/data -v caddy-config:/config \
  -p 80:80 -p 443:443 caddy:2-alpine
```

**nginx** — [`docs/deploy/nginx-tls.conf`](deploy/nginx-tls.conf) for people who
already have nginx and a certificate from elsewhere. Put it in
`/etc/nginx/conf.d/roundhouse.conf` and reload.

Two details that silently break WebSockets, in both samples:

- `/ws` must forward `Upgrade` and `Connection: upgrade`. Without them the
  browser's socket closes immediately and tables never update, while HTTP keeps
  working perfectly.
- `X-Forwarded-For` must be **overwritten** with the proxy's own view of the
  client, not appended. The API trusts that header when `TRUST_PROXY` is set, so
  an appended client-supplied value would let a client choose its own rate-limit
  bucket. Set `TRUST_PROXY=true` when a proxy is in front, and leave it unset
  when players reach the API directly.

When the public address changes, update **both** `BETTER_AUTH_URL` and
`PUBLIC_WEB_URL` and restart: cookies are scoped to the origin, and mail links
are built from `PUBLIC_WEB_URL`.

## Troubleshooting by symptom

| Symptom                                                               | Likely cause and fix                                                                                                                                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server` restarts in a loop, logs a `ZodError`                        | A setting is missing or malformed. The error names the variable and the expectation; fix `.env` and `docker compose up -d`.                                                                              |
| `/ready` → 503, `database` check failing with `deadline exceeded`     | Postgres is down or unreachable. `docker compose ps db`, then check `DATABASE_URL` — inside Compose the host is `db`, not `localhost`.                                                                   |
| `/ready` → 503, `migrations` check failing with a count mismatch      | A new image is running against an older schema. It should not happen through `docker compose up`; if it does, check `docker compose logs server` for a migration error and restore the pre-upgrade dump. |
| Web loads, every API call 502/504                                     | `web` started but the API is not serving: check `docker compose ps server` and `docker compose logs server`.                                                                                             |
| Sign-in fails with `Invalid origin`                                   | `PUBLIC_WEB_URL`/`BETTER_AUTH_URL` do not match the address in the browser's bar (scheme included).                                                                                                      |
| Sign-in works, but the table never updates and the socket closes 4401 | `/ws` is not reaching the API: the proxy is missing the `Upgrade`/`Connection` headers, or the session cookie is not forwarded on `/ws`.                                                                 |
| Everyone is rate limited at once                                      | No proxy, so all players share the socket address as one bucket — expected. Behind a proxy, set `TRUST_PROXY=true`.                                                                                      |
| Password reset mail never arrives                                     | `MAIL_TRANSPORT=log` (the default) writes it to stdout: `docker compose logs server \| grep reset-password`. With SMTP, an unverified `MAIL_FROM` domain is the usual rejection.                         |
| Every player is signed out after an upgrade                           | `BETTER_AUTH_SECRET` changed or was not carried over. Sessions signed with the old secret are gone; sign in again (or restore, if you have the old value).                                               |
| Verification links always fail, sign-in says `EMAIL_NOT_VERIFIED`     | The link expired, was already spent, or `BETTER_AUTH_SECRET` rotated since it was mailed. `AUTH_REQUIRE_VERIFICATION=false` unblocks accounts, at the cost of the check itself.                          |
| Port 5432 already allocated when starting                             | Another Postgres owns the host port. Set `DB_PORT=5499` (or any free port) — the containers talk to each other on their own network.                                                                     |
