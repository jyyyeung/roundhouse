# 0007 — Limits are per-process, and the proxy decides the key

- Status: Accepted
- Date: 2026-11-22
- Issue: [#45](https://github.com/jyyyeung/roundhouse/issues/45)

## Context

Until M1-3, chat was the only rate-limited input: one hand-rolled `Map` of
timestamps inside `apps/server/src/ws/handlers.ts`. Two consequences followed.

**Intents were unlimited.** A client stuck in a retry loop, or a script replaying
an action, could write a `game_event` row per attempt and drive `game.seq` up.
Everything downstream — every resync, every replay, every log line — inherits that
cost, and a table's history becomes unreadable.

**Auth was unlimited in practice.** better-auth's limiter defaults to
`enabled ?? isProduction`, so outside production it was off entirely, and where it
was on it used its own defaults (100 per 10s globally, 3 per 10s on the sensitive
routes) with no relationship to anything documented in this repository. Two
concurrent sign-ups from one address during a probe run tripped it unexpectedly,
which is how the gap was found: the number existed, nobody had chosen it.

There was a third, subtler problem. better-auth resolves a client address from
`x-forwarded-for` by default, and a direct client can send any value it likes. A
limiter keyed on an attacker-chosen string is not a limiter — `TRUST_PROXY` had to
mean something we enforce, not something the library guesses.

## Decision

**One limiter, injected clock, sliding window.** `apps/server/src/ws/rate-limit.ts`
exports `createLimiter({ limit, windowMs, now })` returning
`{ take(key), size() }`. It keeps a per-key list of timestamps, prunes expired keys
every `max(64, limit * 4)` calls, and answers a refusal with
`retryAfterMs = windowMs - (now - oldest)`, clamped to at least 1.

The window slides rather than resetting in fixed buckets: a fixed bucket hands out
two full budgets across one boundary, which is precisely when a client is already
retrying.

**Budgets are separate per input.** Intents and chat each get a limiter keyed by
`tableId:userId`; the chat default stays at its historical 5 per 10s so behaviour
does not change, and intents default to 20 per 10s per player per table. A refused
intent replies with an `error` frame `{ code: "rate_limited", retryAfterMs }`,
writes no event, and — importantly — does not consume the `actionId`, because a
client that retries after the window must get its move applied exactly once.

**Auth limits live in better-auth, configured explicitly.** `createAuthOptions` in
`apps/server/src/auth-options.ts` sets `enabled: true` (not "in production only"),
`storage: "memory"`, and `customRules` for the password and mail routes at
`AUTH_RATE_LIMIT` per `AUTH_RATE_WINDOW_SECONDS`. The global default is left alone
so a table full of players behind one NAT address does not throttle `/get-session`.
The reset and verification routes are named before they exist (M1-1) so they
cannot ship unlimited even for one release.

**`TRUST_PROXY` is enforced by us.** `apps/server/src/http/client-ip.ts` resolves
the client address — `x-forwarded-for` only when `TRUST_PROXY` is set, otherwise the
socket address — and rewrites the header on the request before `auth.handler` sees
it. `apps/web/nginx.conf` overwrites `x-forwarded-for` with `$remote_addr` rather
than appending, so the chain has exactly one hop we control, and
`docker-compose.yml` sets `TRUST_PROXY: "true"` to match.

## Consequences

- Limits are stated, documented and testable; a deployment can tighten them with
  an environment variable and no rebuild.
- **State is per-process memory.** Two replicas allow two budgets, and a restart
  forgets every budget. This is written down in `docs/ops.md` and the README rather
  than hidden; a shared store would change `createLimiter`'s storage, not its
  callers.
- A proxy that appends instead of overwriting breaks the guarantee. The shipped
  nginx config is correct; anyone replacing it must overwrite, and anyone exposing
  the API directly must leave `TRUST_PROXY` unset.
- The intent budget is per player per table, not per IP, so one account cannot
  starve another at the same table.
- Refusing before `rememberAction` means the limiter is also the first thing a run
  of duplicate frames hits, which is the desired order: a flood costs one Map
  lookup, not an action-id reservation.

## Alternatives considered

- **Keep the hand-rolled window and copy it.** Two windows drift; the chat one had
  no `retryAfterMs` and no testable clock.
- **A shared token bucket in Redis or Postgres.** Correct for a fleet, but it adds
  a dependency and a failure mode (limiter down → all auth down) to a single-box
  deployment that does not have the problem yet.
- **Trust better-auth's defaults and set only `max`.** The per-route rules are
  better-auth's opinion, not ours, and they change between versions; the limit we
  advertise has to be the limit we set.
- **Per-IP intent limits.** NAT makes them unfair to a household and useless
  against one account; the seat is the natural key.
