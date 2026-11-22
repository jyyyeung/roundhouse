# 0008 — Mail is a port, and the token is spent by a page we own

- Status: Accepted
- Date: 2026-11-22
- Issue: [#43](https://github.com/jyyyeung/roundhouse/issues/43)

## Context

Until M1-1 the server enabled `emailAndPassword` and nothing else. Three
consequences: a player who forgot a password could only be rescued by editing
Postgres, nothing proved an address belonged to its owner, and a table full of
friends could only be reached through one provider.

Every one of those fixes needs to send mail, which a self-hosted game server
usually cannot do. Requiring SMTP just to develop, run the smoke test, or play on
a laptop would have made the whole feature untestable in the environment it is
most used in — and untestable features rot.

The second question was the shape of the link. better-auth builds
`${baseURL}/reset-password/:token?callbackURL=…` and redirects to the
`callbackURL` it is handed. That is a redirect to an arbitrary site with a
credential in the path — an open redirect wearing a convenience feature's
clothes — and it means the consuming page lives outside the app, so nothing in
`apps/web` would ever be exercised by a reset.

## Decision

**Mail is an injected port.** `apps/server/src/mail.ts` declares
`Mailer = { send(message: MailMessage): Promise<void> }` and ships two
implementations: `logMailer`, which writes one JSON line per message to stdout,
and `smtpMailer`, which loads `nodemailer` lazily so the default image carries no
mail client at all. `MAIL_TRANSPORT` selects one, `env.ts` refuses
`MAIL_TRANSPORT=smtp` without `MAIL_SMTP_URL` at boot (a half-configured mail
server fails where an operator is looking, not on the first reset at 3am), and
tests inject `captureMailer()`.

The log transport is what makes the flow provable: `scripts/smoke.mjs` reads the
reset link back out of the server's log and finishes the round trip against a
real database, and `scripts/compose-smoke.sh` follows `docker compose logs` so the
packaged stack proves the same thing. A reset link in a log is a credential, and
that is stated where the transport is selected rather than discovered.

**We build the link, so the token is spent by our own page.** `sendResetPassword`
and `sendVerificationEmail` are given `${PUBLIC_WEB_URL}/reset-password?token=…`
and `${PUBLIC_WEB_URL}/verify-email?token=…` instead of better-auth's
`callbackURL` shape. The page reads the token from the query string and spends it
against `POST /api/auth/reset-password` (or `GET /api/auth/verify-email`), so
there is no cross-origin redirect, no third-party landing page, and the reset UI
is part of the app and covered by its tests.

**Verification is off by default and on by intent.** `AUTH_REQUIRE_VERIFICATION`
follows the deployment's choice rather than hard-coding "production"; when set,
sign-in answers `403 EMAIL_NOT_VERIFIED` and creating or joining a table answers
`needs_verify`. `GET /api/auth/providers` reports `{ google: boolean }` so the
sign-in page asks the server instead of drawing a button that leads nowhere, and
a half-configured Google client fails at boot for the same reason SMTP does.

## Consequences

- A dev stack, the smoke test and the compose smoke all exercise password reset
  end to end with no mail server. The same code path serves production once
  `MAIL_TRANSPORT=smtp` and `MAIL_SMTP_URL` are set.
- The server owns the link shape, which means it also owns keeping
  `PUBLIC_WEB_URL` correct. It is already load-bearing for trusted origins and
  cookies, so a wrong value was already a broken deployment; now the mail says so
  too.
- Reset tokens are single use, expire in an hour, and
  `revokeSessionsOnPasswordReset` is on: a successful reset signs out every other
  browser. Verification tokens are JWTs better-auth signs with
  `BETTER_AUTH_SECRET`, so rotating that secret invalidates every outstanding
  verification link. That is acceptable — the player asks for another — and it is
  the same secret whose loss already means full compromise.
- `request-password-reset` answers `200` with an identical body for known and
  unknown addresses, so it cannot be used to enumerate accounts. The cost is that
  a genuine player who mistypes their address gets no feedback; the alternative
  hands attackers a membership oracle.
- Verification defaults to off, so a public deployment that forgets the variable
  is as unprotected as before. This is a documented default, not an oversight:
  turning it on by default would strand every existing account created before
  M1-1 with no way to sign in until mail is configured.

## Alternatives considered

- **Require SMTP everywhere, including dev.** Correct for production and hostile
  to everything else; the log transport costs a dozen lines and buys an end-to-end
  test.
- **Keep better-auth's `callbackURL` link.** Fewer lines, but the reset page then
  lives outside the router, an attacker-chosen `redirectTo` becomes a redirect
  target, and no component test can reach the page.
- **A `mail` table plus a background worker.** Durable delivery and retries, at
  the cost of a queue, a worker process and a second failure mode, for a game
  server whose volume is a handful of messages an hour.
- **Verify-by-default with an environment escape hatch.** Would have been the
  right default for a new product; with accounts already in the database it locks
  out every existing player the moment mail is unconfigured.
- **Hand-rolled reset tokens in our own table.** better-auth already stores them
  in `verification`, hashes nothing, expires correctly and deletes sessions on
  use; reimplementing that would add a table and a class of bugs without removing
  a dependency.
