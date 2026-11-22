/**
 * Auth limits against real Postgres (M1-3, #45).
 *
 * better-auth's limiter is in-memory and lives in its HTTP router, so the only
 * way to test it honestly is to build the same options the server uses and talk
 * to the handler. A hand-written limiter double would pass while the real one
 * was misconfigured.
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
import { captureMailer } from "../mail";
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
  ? "auth limits against real Postgres"
  : "auth limits against real Postgres (skipped: set DATABASE_URL_TEST to a *_test database)";

const integration = testUrl ? describe : describe.skip;

integration(title, () => {
  const sql = postgres(testUrl as string, { max: 10 });
  const db = drizzle(sql, { schema });
  const auth = betterAuth(createAuthOptions(db, { mailer: captureMailer() }));

  const origin = process.env.PUBLIC_WEB_URL as string;
  let ipCounter = 0;
  /**
   * better-auth keys its buckets on `ip|path`, and the memory store outlives a
   * single test in this file. A fresh address per test keeps them independent
   * the same way separate clients are.
   */
  const freshIp = () => {
    ipCounter += 1;
    return `198.51.100.${ipCounter}`;
  };

  const password = "correct-horse-battery-staple";

  async function post(path: string, body: unknown, ip: string) {
    return auth.handler(
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
  }

  async function makeAccount(email: string) {
    await auth.api.signUpEmail({ body: { email, name: "Rate Limit", password } });
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

  it("refuses the eleventh sign-in and never compares the password that time", async () => {
    const email = "limited@integration.test";
    await makeAccount(email);
    const ip = freshIp();

    const wrong: number[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await post("/sign-in/email", { email, password: "not-the-password" }, ip);
      wrong.push(response.status);
    }
    expect(wrong).toEqual(Array.from({ length: 10 }, () => 401));

    // The right password at this point must also be refused: the limiter runs
    // before the credential check, so there is nothing to guess against.
    const blocked = await post("/sign-in/email", { email, password }, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("set-cookie")).toBeNull();
  });

  it("gives a different client address its own budget", async () => {
    const email = "shared@integration.test";
    await makeAccount(email);
    const exhausting = freshIp();

    for (let attempt = 0; attempt < 11; attempt += 1) {
      await post("/sign-in/email", { email, password: "not-the-password" }, exhausting);
    }
    const blocked = await post(
      "/sign-in/email",
      { email, password: "not-the-password" },
      exhausting,
    );
    expect(blocked.status).toBe(429);

    const other = await post("/sign-in/email", { email, password }, freshIp());
    expect(other.status).toBe(200);
    expect(other.headers.get("set-cookie")).not.toBeNull();
  });

  it("limits password-reset requests the same way", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await post(
        "/request-password-reset",
        { email: "nobody@integration.test", redirectTo: `${origin}/reset` },
        ip,
      );
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10)).not.toContain(429);
    expect(statuses[10]).toBe(429);
  });
});
