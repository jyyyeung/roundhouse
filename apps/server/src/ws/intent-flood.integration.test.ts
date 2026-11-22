/**
 * Intent budget against real Postgres (M1-3, #45).
 *
 * The unit tests prove the limiter's arithmetic and the handler's ordering; this
 * proves the consequence a player cares about — a client stuck in a retry loop
 * cannot write rows or advance the game. It drives the real handlers over the
 * real runtime, so the allowed intents below genuinely hit jsonb and the event
 * log. Skipped unless `DATABASE_URL_TEST` points at a throwaway database.
 */

import type { Json, ServerMessage } from "@roundhouse/game-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { schema, user } from "../db/schema";
import { env } from "../env";
import { createRoomRuntime } from "../room/runtime";
import { assertDisposableDatabase } from "../test/assert-disposable-database";
import { createWsHandlers } from "./handlers";

const testUrl = process.env.DATABASE_URL_TEST;

if (testUrl) assertDisposableDatabase(testUrl);

if (testUrl) {
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-0123456789abcdef";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
  process.env.PUBLIC_WEB_URL ??= "http://localhost:5173";
}

const title = testUrl
  ? "intent budget against real Postgres"
  : "intent budget against real Postgres (skipped: set DATABASE_URL_TEST to a *_test database)";

const integration = testUrl ? describe : describe.skip;

integration(title, () => {
  const sql = postgres(testUrl as string, { max: 10 });
  const db = drizzle(sql, { schema });
  const runtime = createRoomRuntime(db);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  });

  beforeEach(async () => {
    await sql`
      truncate table
        game_event, chat_message, game, table_player, game_table,
        session, account, "user"
      restart identity cascade
    `;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function makeUser(id: string) {
    await db.insert(user).values({
      email: `${id}@integration.test`,
      emailVerified: true,
      id,
      name: id,
    });
    return id;
  }

  it("refuses intents past the budget, writing no rows and leaving seq alone", async () => {
    const host = await makeUser("flood-host");
    const guest = await makeUser("flood-guest");
    const table = await runtime.createTable({
      config: { ruleset: "yatzy" } satisfies Json,
      gameId: "yatzy",
      userId: host,
    });
    await runtime.joinTable({ code: table.code, userId: guest });
    await runtime.startTable({ tableId: table.tableId, userId: host });

    // The action-id map is per-table in the hub; here it is per test, which is the
    // same thing for one client.
    const actionIds = new Set<string>();
    const sent: ServerMessage[] = [];
    const handlers = createWsHandlers({
      isDuplicateAction: (_tableId, actionId) => actionIds.has(actionId),
      publishApplied: () => {},
      publishToTable: () => {},
      rememberAction: (_tableId, actionId) => actionIds.add(actionId),
      forgetAction: (_tableId, actionId) => actionIds.delete(actionId),
      runtime,
    });

    const send = (actionId: string) =>
      handlers.onMessage(
        { send: (message) => sent.push(message), tableId: table.tableId, userId: host },
        {
          actionId,
          intentType: "roll",
          payload: {} satisfies Json,
          tableId: table.tableId,
          type: "intent",
          v: 2,
        },
      );

    const limit = env.INTENT_RATE_LIMIT;
    for (let attempt = 0; attempt < limit; attempt += 1) {
      await send(`action-${attempt}`);
    }
    // Inside the budget the limiter never speaks: an illegal move is the game's
    // answer, not the limiter's, so only those errors may appear.
    const limited = sent.filter(
      (message) => message.type === "error" && message.code === "rate_limited",
    );
    expect(limited).toEqual([]);

    const stored = () =>
      sql<{ events: number; seq: number }[]>`
        select g.seq as seq,
          (select count(*)::int from game_event e where e.game_row_id = g.id) as events
        from game g where g.table_id = ${table.tableId}
      `;
    const [before] = await stored();

    await send("action-over-budget");

    const [after] = await stored();
    const refused = sent.at(-1) as Extract<ServerMessage, { type: "error" }> | undefined;
    expect(refused).toMatchObject({
      actionId: "action-over-budget",
      code: "rate_limited",
      tableId: table.tableId,
      type: "error",
    });
    expect(refused?.retryAfterMs).toBeGreaterThan(0);
    expect(refused?.retryAfterMs).toBeLessThanOrEqual(env.INTENT_RATE_WINDOW_MS);

    // Nothing moved: no event rows, no seq bump, and the table is not stuck.
    expect(after).toEqual(before);
  });
});
