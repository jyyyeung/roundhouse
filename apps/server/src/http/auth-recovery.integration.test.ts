/**
 * Account recovery against real Postgres (M1-1, #43).
 *
 * The interesting parts of a reset — a token that is spent once, an expiry, a
 * session that dies with the password — are better-auth's, and a hand-rolled
 * double would keep passing while the real wiring was wrong. So this suite
 * builds the same options the server builds, over a throwaway database, and
 * reads the link out of a capturing mailer instead of a mailbox.
 *
 * Skipped unless `DATABASE_URL_TEST` points at a throwaway database:
 *
 *   DATABASE_URL_TEST=postgres://roundhouse:roundhouse@localhost:5432/roundhouse_test \
 *     just test-integration
 */

import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAuthOptions } from "../auth-options";
import { schema } from "../db/schema";
import { type CapturingMailer, captureMailer, type MailMessage } from "../mail";
import { assertDisposableDatabase } from "../test/assert-disposable-database";

const testUrl = process.env.DATABASE_URL_TEST;

if (testUrl) assertDisposableDatabase(testUrl);

if (testUrl) {
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-0123456789abcdef";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
  process.env.PUBLIC_WEB_URL ??= "http://localhost:5173";
  // Assert the limits a deployment gets by default, not whatever a shell exports.
  process.env.AUTH_RATE_LIMIT ??= "10";
  process.env.AUTH_RATE_WINDOW_SECONDS ??= "60";
}

const title = testUrl
  ? "account recovery against real Postgres"
  : "account recovery against real Postgres (skipped: set DATABASE_URL_TEST to a *_test database)";

const integration = testUrl ? describe : describe.skip;

const password = "correct-horse-battery-staple";
const newPassword = "a-different-horse-battery";

integration(title, () => {
  const sql = postgres(testUrl as string, { max: 10 });
  const db = drizzle(sql, { schema });

  const origin = process.env.PUBLIC_WEB_URL as string;
  let ipCounter = 0;

  /**
   * A fresh address per test keeps better-auth's in-memory buckets apart the way
   * separate clients would be: the store outlives a single test in this file.
   */
  const freshIp = () => {
    ipCounter += 1;
    return `203.0.113.${ipCounter}`;
  };

  /**
   * One mailer per auth instance, so a test reads exactly the mail it caused.
   * `requireVerification` is the option the server reads from the environment.
   */
  function instance(options: { requireVerification?: boolean } = {}) {
    const mailer = captureMailer();
    const auth = betterAuth(createAuthOptions(db, { mailer, ...options }));
    return { auth, mailer };
  }

  type Auth = ReturnType<typeof instance>["auth"];

  const post = (auth: Auth, path: string, body: unknown, ip: string) =>
    auth.handler(
      new Request(`http://localhost:3001/api/auth${path}`, {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          origin,
          "x-forwarded-for": ip,
        },
        method: "POST",
      }),
    );

  const get = (auth: Auth, path: string, cookie?: string) =>
    auth.handler(
      new Request(`http://localhost:3001/api/auth${path}`, {
        headers: { cookie: cookie ?? "", origin },
        method: "GET",
      }),
    );

  /** The first `name=value` pair of a `set-cookie` header. */
  const cookieFrom = (response: Response) =>
    (response.headers.get("set-cookie") ?? "").split(";")[0];

  /**
   * The token our own link carries, wherever the message puts it. A verification
   * token is a JWT, so it contains dots: stopping at the first non-base64url
   * character would cut a real token in half.
   */
  const tokenFrom = (message: MailMessage | undefined) =>
    /[?&]token=([^&\s]+)/.exec(message?.body ?? "")?.[1] ?? "";

  const isReset = (message: MailMessage) => /reset/i.test(message.subject);
  const isVerification = (message: MailMessage) => /confirm/i.test(message.subject);

  /**
   * better-auth may send in the background, so a bare `take()` races the send,
   * and sign-up sends a verification mail that would otherwise be mistaken for
   * the message under test. Wait until a matching message has arrived, then take
   * everything and hand back the matches.
   */
  async function takeMail(
    mailer: CapturingMailer,
    matches: (message: MailMessage) => boolean = () => true,
  ): Promise<MailMessage[]> {
    for (let attempt = 0; attempt < 100 && !mailer.messages.some(matches); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return mailer.take().filter(matches);
  }

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  });

  beforeEach(async () => {
    await sql`
      truncate table
        game_event, chat_message, game, table_player, game_table,
        session, account, verification, "user"
      restart identity cascade
    `;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("mails a link for a known address and answers identically for an unknown one", async () => {
    const { auth, mailer } = instance();
    const ip = freshIp();
    const email = "known@integration.test";
    await auth.api.signUpEmail({ body: { email, name: "Known", password } });
    await takeMail(mailer, isVerification);

    const known = await post(auth, "/request-password-reset", { email }, ip);
    expect(known.status).toBe(200);
    const sent = await takeMail(mailer, isReset);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(email);
    expect(sent[0]?.subject).toMatch(/reset/i);
    // The link points at the web app, not at the API: a human clicks it.
    expect(sent[0]?.body).toContain(`${origin}/reset-password?token=`);
    expect(tokenFrom(sent[0])).not.toBe("");

    const knownBody = await known.json();
    const unknown = await post(
      auth,
      "/request-password-reset",
      { email: "nobody@integration.test" },
      ip,
    );
    expect(unknown.status).toBe(200);
    // Same answer both ways: the response is not an address book.
    expect(await unknown.json()).toEqual(knownBody);
    expect(mailer.take().filter(isReset)).toHaveLength(0);
  });

  it("spends the link once: new password works, old one fails, older sessions are gone", async () => {
    const { auth, mailer } = instance();
    const ip = freshIp();
    const email = "reset@integration.test";
    await auth.api.signUpEmail({ body: { email, name: "Reset", password } });
    await takeMail(mailer, isVerification);

    const signedIn = await post(auth, "/sign-in/email", { email, password }, ip);
    expect(signedIn.status).toBe(200);
    const oldCookie = cookieFrom(signedIn);
    expect(oldCookie).not.toBe("");
    expect(await (await get(auth, "/get-session", oldCookie)).json()).not.toBeNull();

    await post(auth, "/request-password-reset", { email }, ip);
    const token = tokenFrom((await takeMail(mailer, isReset))[0]);
    expect(token).not.toBe("");

    const reset = await post(auth, "/reset-password", { newPassword, token }, ip);
    expect(reset.status).toBe(200);

    // The session that existed before the reset must not survive it: a reset is
    // what someone does when they think a password leaked.
    expect(await (await get(auth, "/get-session", oldCookie)).json()).toBeNull();

    const stale = await post(auth, "/sign-in/email", { email, password }, ip);
    expect(stale.status).toBe(401);

    const fresh = await post(auth, "/sign-in/email", { email, password: newPassword }, ip);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("set-cookie")).not.toBeNull();
  });

  it("refuses a spent token, an expired token and a made-up one as errors, never a crash", async () => {
    const { auth, mailer } = instance();
    const ip = freshIp();
    const email = "twice@integration.test";
    await auth.api.signUpEmail({ body: { email, name: "Twice", password } });
    await takeMail(mailer, isVerification);

    await post(auth, "/request-password-reset", { email }, ip);
    const spent = tokenFrom((await takeMail(mailer, isReset))[0]);
    expect(spent).not.toBe("");

    expect((await post(auth, "/reset-password", { newPassword, token: spent }, ip)).status).toBe(
      200,
    );
    const reused = await post(auth, "/reset-password", { newPassword, token: spent }, ip);
    expect(reused.status).toBe(400);
    expect((await reused.json()).code).toBe("INVALID_TOKEN");

    // Age every pending reset row rather than waiting an hour.
    await post(auth, "/request-password-reset", { email }, ip);
    const expired = tokenFrom((await takeMail(mailer, isReset))[0]);
    await sql`update verification set expires_at = now() - interval '1 hour' where identifier like 'reset-password:%'`;
    const stale = await post(auth, "/reset-password", { newPassword, token: expired }, ip);
    expect(stale.status).toBe(400);
    expect((await stale.json()).code).toBe("INVALID_TOKEN");

    const invented = await post(
      auth,
      "/reset-password",
      { newPassword, token: "not-a-real-token" },
      ip,
    );
    expect(invented.status).toBe(400);
  });

  it("mails a verification link on sign-up and refuses an unproven address at sign-in", async () => {
    const { auth, mailer } = instance({ requireVerification: true });
    const email = "verify@integration.test";

    const signedUp = await auth.api.signUpEmail({ body: { email, name: "Verify", password } });
    expect(signedUp.user.emailVerified).toBe(false);

    const sent = await takeMail(mailer, isVerification);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toContain(`${origin}/verify-email?token=`);
    const token = tokenFrom(sent[0]);
    expect(token).not.toBe("");

    const refused = await post(auth, "/sign-in/email", { email, password }, freshIp());
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("EMAIL_NOT_VERIFIED");

    // What the page does with the token from the mail.
    const verified = await get(auth, `/verify-email?token=${token}`);
    expect(verified.status).toBe(200);

    const accepted = await post(auth, "/sign-in/email", { email, password }, freshIp());
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("set-cookie")).not.toBeNull();
  });
});
