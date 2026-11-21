/**
 * Room runtime against real Postgres (M0-5, #15).
 *
 * Everything else in the server suite fakes the database, so it cannot fail on a
 * lock ordering, a unique-constraint race, or a jsonb round trip. This file runs
 * the real migrations and the real SQL, and is skipped unless `DATABASE_URL_TEST`
 * points at a throwaway database.
 *
 *   createdb roundhouse_test                     # or: psql -c 'create database roundhouse_test'
 *   DATABASE_URL_TEST=postgres://roundhouse:roundhouse@localhost:5432/roundhouse_test \
 *     pnpm --filter @roundhouse/server test
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { schema, user } from "../db/schema";
import { createRoomRuntime, TablesError } from "./runtime";

const testUrl = process.env.DATABASE_URL_TEST;

/**
 * Truncating the wrong database would delete a developer's games, so the name
 * must say what it is. A misconfigured run fails loudly instead of skipping.
 */
function assertDisposableDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(
      `DATABASE_URL_TEST must point at a database whose name ends in _test (got "${name}"). ` +
        "This suite truncates every table between tests.",
    );
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL_TEST must not be the same database as DATABASE_URL.");
  }
}

if (testUrl) assertDisposableDatabase(testUrl);

// The hub imports the real db client, which validates env at import time. The
// integration suite is the only place that talks to a database for real, so it
// points those variables at the throwaway one rather than the dev stack.
if (testUrl) {
  process.env.DATABASE_URL ??= testUrl;
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-0123456789abcdef";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
  process.env.PUBLIC_WEB_URL ??= "http://localhost:5173";
}

const title = testUrl
  ? "room runtime against real Postgres"
  : "room runtime against real Postgres (skipped: set DATABASE_URL_TEST to a *_test database)";

const integration = testUrl ? describe : describe.skip;

integration(title, () => {
  // `testUrl` is checked above; the cast exists because narrowing does not
  // survive into a describe callback.
  const sql = postgres(testUrl as string, { max: 10 });
  const db = drizzle(sql, { schema });
  const runtime = createRoomRuntime(db);

  let userCounter = 0;

  beforeAll(async () => {
    // Real migrations, never db:push: this is the same SQL a deploy runs.
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

  async function makeUser() {
    userCounter += 1;
    const name = `user-${userCounter}`;
    await db.insert(user).values({
      email: `${name}@integration.test`,
      emailVerified: true,
      id: name,
      name,
    });
    return name;
  }

  async function makeTable(host: string, options: { gameId?: string; softSeatCap?: number } = {}) {
    return runtime.createTable({
      config: { ruleset: "yatzy" },
      gameId: options.gameId ?? "yatzy",
      softSeatCap: options.softSeatCap ?? 4,
      userId: host,
    });
  }

  async function seatTable(playerCount: number, options: { softSeatCap?: number } = {}) {
    const players = await Promise.all(Array.from({ length: playerCount }, () => makeUser()));
    const table = await makeTable(players[0], options);
    for (const player of players.slice(1)) {
      await runtime.joinTable({ code: table.code, userId: player });
    }
    return { ...table, players };
  }

  async function startedGame(playerCount = 2) {
    const seats = await seatTable(playerCount);
    const started = await runtime.startTable({ tableId: seats.tableId, userId: seats.players[0] });
    return { ...seats, gameRowId: started.gameRowId };
  }

  async function gameRow(gameRowId: string) {
    const [row] = await sql<{ state: Record<string, unknown>; seq: number }[]>`
      select state, seq from game where id = ${gameRowId}
    `;
    return row;
  }

  async function eventSeqs(gameRowId: string) {
    const rows = await sql<{ seq: number }[]>`
      select seq from game_event where game_row_id = ${gameRowId} order by seq
    `;
    return rows.map((row) => row.seq);
  }

  async function seatCount(tableId: string) {
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from table_player where table_id = ${tableId}
    `;
    return row.count;
  }

  async function expectTablesError(promise: Promise<unknown>, code: string) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TablesError);
    expect((caught as TablesError).code).toBe(code);
  }

  /**
   * Plays one legal intent for whoever's turn it is, reading the stored state so
   * the sequence keeps working when the rules change (roll while rolls remain,
   * then score an empty category).
   */
  async function playOneLegalIntent(input: {
    gameRowId: string;
    randomInt?: (maxExclusive: number) => number;
    seatUserIds: string[];
    tableId: string;
  }) {
    const { state } = await gameRow(input.gameRowId);
    const turn = state as {
      currentPlayerIndex: number;
      rollsLeft: number;
      sheets: Record<string, Record<string, number | null>>;
    };
    const userId = input.seatUserIds[turn.currentPlayerIndex];
    const randomInt = input.randomInt ?? (() => 0);

    if (turn.rollsLeft > 0) {
      return runtime.applyGameIntent({
        intent: { payload: {}, type: "roll" },
        randomInt,
        tableId: input.tableId,
        userId,
      });
    }

    const sheet = turn.sheets[userId] ?? {};
    const category = Object.keys(sheet).find((key) => key !== "bonus" && sheet[key] === null);
    if (!category) throw new Error(`no empty category left for ${userId}`);

    return runtime.applyGameIntent({
      intent: { payload: { category }, type: "score" },
      randomInt,
      tableId: input.tableId,
      userId,
    });
  }

  /** The hub dispatches frames off the socket callback, so poll instead of assuming. */
  async function waitFor(predicate: () => boolean, description: string, timeoutMs = 5_000) {
    const startedAt = Date.now();
    while (!predicate()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`timed out waiting for ${description}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  describe("seat assignment", () => {
    it("seats parallel joins on unique, contiguous indices", async () => {
      const host = await makeUser();
      const { tableId, code } = await makeTable(host, { softSeatCap: 8 });
      const joiners = await Promise.all(Array.from({ length: 6 }, () => makeUser()));

      const results = await Promise.all(
        joiners.map((player) => runtime.joinTable({ code, userId: player })),
      );

      expect(results.every((result) => result.tableId === tableId)).toBe(true);

      const seats = await sql<{ seat_index: number }[]>`
        select seat_index from table_player where table_id = ${tableId} order by seat_index
      `;
      // The host took seat 0, so six joiners land on 1..6.
      expect(seats.map((row) => row.seat_index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it("surfaces table_full at the cap instead of a constraint violation", async () => {
      const { tableId, code } = await seatTable(4, { softSeatCap: 4 });
      const extra = await makeUser();

      await expectTablesError(runtime.joinTable({ code, userId: extra }), "table_full");
      expect(await seatCount(tableId)).toBe(4);
    });

    it("treats a re-join by a seated player as idempotent", async () => {
      const { tableId, code, players } = await seatTable(2);

      await expect(runtime.joinTable({ code, userId: players[1] })).resolves.toEqual({
        tableId,
      });
      expect(await seatCount(tableId)).toBe(2);
    });

    it("refuses a join to a started table and does not mutate it", async () => {
      const { tableId, code } = await startedGame(2);
      const latecomer = await makeUser();

      await expectTablesError(runtime.joinTable({ code, userId: latecomer }), "table_closed");
      expect(await seatCount(tableId)).toBe(2);
    });

    it("documents the softSeatCap: 1 gap — a one-seat table can never start", async () => {
      // Known gap (roadmap): create accepts cap 1, but a game needs two players.
      const host = await makeUser();
      const { tableId } = await makeTable(host, { softSeatCap: 1 });

      await expectTablesError(runtime.startTable({ tableId, userId: host }), "not_enough_players");
    });
  });

  describe("table lifecycle", () => {
    it("creates exactly one game row when start is raced", async () => {
      const { tableId, players } = await seatTable(2);

      const [first, second] = await Promise.all([
        runtime.startTable({ tableId, userId: players[0] }),
        runtime.startTable({ tableId, userId: players[0] }),
      ]);

      const [row] = await sql<{ count: number }[]>`
        select count(*)::int as count from game where table_id = ${tableId}
      `;
      expect(row.count).toBe(1);
      expect(first.gameRowId).toBe(second.gameRowId);
    });

    it("starts a game with contiguous-empty log and seq 0", async () => {
      const { tableId, gameRowId, players } = await startedGame(3);

      expect((await gameRow(gameRowId)).seq).toBe(0);
      expect(await eventSeqs(gameRowId)).toEqual([]);

      const result = await runtime.applyGameIntent({
        intent: { payload: {}, type: "roll" },
        randomInt: () => 0,
        tableId,
        userId: players[0],
      });

      expect(result.ok).toBe(true);
      expect(await eventSeqs(gameRowId)).toEqual([1]);
      expect((await gameRow(gameRowId)).seq).toBe(1);
    });

    it("returns the same game for a rematch on an active table", async () => {
      const { tableId, gameRowId, players } = await startedGame(2);

      const rematch = await runtime.rematchTable({ tableId, userId: players[1] });

      expect(rematch.gameRowId).toBe(gameRowId);
    });

    it("lists hosted and joined tables, and nothing for a fresh user", async () => {
      const { tableId, players } = await seatTable(2);
      const stranger = await makeUser();

      const hostView = await runtime.getMine({ userId: players[0] });
      const guestView = await runtime.getMine({ userId: players[1] });
      const strangerView = await runtime.getMine({ userId: stranger });

      expect(hostView.map((table) => table.id)).toEqual([tableId]);
      expect(guestView.map((table) => table.id)).toEqual([tableId]);
      expect(strangerView).toEqual([]);
    });
  });

  describe("concurrent intents", () => {
    it("keeps game.seq and game_event.seq contiguous under parallel intents", async () => {
      const { tableId, gameRowId, players } = await startedGame(2);

      // Six intents at once from both seats: at most three rolls are legal, the
      // rest must come back as illegal_action, never as a 500 or a seq conflict.
      const intents = await Promise.all(
        Array.from({ length: 6 }, (_unused, index) =>
          runtime.applyGameIntent({
            intent: { payload: {}, type: "roll" },
            randomInt: () => index % 6,
            tableId,
            userId: players[index % 2],
          }),
        ),
      );

      const applied = intents.filter((result) => result.ok);
      const rejected = intents.filter((result) => !result.ok);

      expect(applied.length + rejected.length).toBe(6);
      expect(
        rejected.every((result) => result.ok === false && result.code === "illegal_action"),
      ).toBe(true);

      // Then serialise the rest of a turn so the log has a mix of event shapes.
      for (let step = 0; step < 8; step += 1) {
        await playOneLegalIntent({ gameRowId, seatUserIds: players, tableId });
      }

      const stored = await gameRow(gameRowId);
      const seqs = await eventSeqs(gameRowId);

      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_unused, index) => index + 1));
      expect(stored.seq).toBe(seqs.length);
    });

    it("applies a repeated actionId at most once, across a reconnect", async () => {
      const { createWsHub } = await import("../ws/hub");
      const { tableId, gameRowId, players } = await startedGame(2);

      const hub = createWsHub({
        getSessionFromHeaders: () => ({ user: { id: players[0] } }),
        runtime,
      });

      const socket = new MockSocket();
      await hub.handleConnection(
        socket as unknown as Parameters<typeof hub.handleConnection>[0],
        { headers: {} } as Parameters<typeof hub.handleConnection>[1],
      );
      await socket.emitMessage({ tableId, type: "subscribe", v: 2 });
      await waitFor(
        () => socket.frames().some((frame: { type: string }) => frame.type === "snapshot"),
        "the subscribe snapshot",
      );

      const intent = {
        actionId: "action-once",
        intentType: "roll",
        payload: {},
        tableId,
        type: "intent",
        v: 2,
      };

      const appliedFrames = () =>
        socket.frames().filter((frame: { type: string }) => frame.type === "applied");

      // Send the same actionId twice, as a client does when a reconnect races a retry.
      await socket.emitMessage(intent);
      await socket.emitMessage(intent);
      await waitFor(() => appliedFrames().length > 0, "the applied frame");
      // Give a second broadcast the chance to show up before asserting it did not.
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(appliedFrames()).toHaveLength(1);
      expect(appliedFrames()[0]).toMatchObject({ seq: 1, tableId });
      expect(await eventSeqs(gameRowId)).toEqual([1]);
    });

    it("rejects an out-of-turn intent without writing anything", async () => {
      const { tableId, gameRowId, players } = await startedGame(2);

      const result = await runtime.applyGameIntent({
        intent: { payload: {}, type: "roll" },
        randomInt: () => 0,
        tableId,
        userId: players[1],
      });

      expect(result).toMatchObject({ code: "illegal_action", ok: false });
      expect(await eventSeqs(gameRowId)).toEqual([]);
      expect((await gameRow(gameRowId)).seq).toBe(0);
    });
  });

  describe("TablesError codes", () => {
    it("unknown_table: join with a code nobody used", async () => {
      await expectTablesError(
        runtime.joinTable({ code: "ZZZZZZ", userId: await makeUser() }),
        "unknown_table",
      );
    });

    it("unknown_game: create or start a table whose module is missing", async () => {
      const host = await makeUser();
      await expectTablesError(
        runtime.createTable({ config: {}, gameId: "poker", userId: host }),
        "unknown_game",
      );

      // A table row can name a game that was later unregistered: start must fail
      // with the documented code rather than a stack trace from the registry.
      await sql`
        insert into game_table
          (id, code, game_id, config, status, host_user_id, soft_seat_cap, created_at)
        values ('table-poker', 'POKER1', 'poker', '{}'::jsonb, 'lobby', ${host}, 4, now())
      `;
      await sql`
        insert into table_player (table_id, user_id, seat_index)
        values ('table-poker', ${host}, 0), ('table-poker', ${await makeUser()}, 1)
      `;

      await expectTablesError(
        runtime.startTable({ tableId: "table-poker", userId: host }),
        "unknown_game",
      );
    });

    it("table_missing: start or rematch a table that does not exist", async () => {
      const host = await makeUser();

      await expectTablesError(
        runtime.startTable({ tableId: "table-nope", userId: host }),
        "table_missing",
      );
      await expectTablesError(
        runtime.rematchTable({ tableId: "table-nope", userId: host }),
        "table_missing",
      );
    });

    it("not_host: only the host may start", async () => {
      const { tableId, players } = await seatTable(2);

      await expectTablesError(runtime.startTable({ tableId, userId: players[1] }), "not_host");
    });

    it("table_not_lobby: start a table that has left the lobby", async () => {
      const { tableId, players } = await seatTable(2);
      await sql`update game_table set status = 'active' where id = ${tableId}`;

      await expectTablesError(
        runtime.startTable({ tableId, userId: players[0] }),
        "table_not_lobby",
      );
    });

    it("not_a_player: only a seated player may rematch", async () => {
      const { tableId, gameRowId } = await startedGame(2);
      await sql`update game set status = 'finished', finished_at = now() where id = ${gameRowId}`;
      const stranger = await makeUser();

      await expectTablesError(runtime.rematchTable({ tableId, userId: stranger }), "not_a_player");
    });

    it("rematch_unavailable: rematch a lobby table with no finished game", async () => {
      const { tableId, players } = await seatTable(2);

      await expectTablesError(
        runtime.rematchTable({ tableId, userId: players[0] }),
        "rematch_unavailable",
      );
    });

    it("rematch on a finished game creates a fresh game row", async () => {
      const { tableId, gameRowId, players } = await startedGame(2);

      // Roll once so the finished game has a non-empty log, then close it.
      await runtime.applyGameIntent({
        intent: { payload: {}, type: "roll" },
        randomInt: () => 0,
        tableId,
        userId: players[0],
      });
      await sql`update game set status = 'finished', finished_at = now() where id = ${gameRowId}`;

      const rematch = await runtime.rematchTable({ tableId, userId: players[1] });

      expect(rematch.gameRowId).not.toBe(gameRowId);
      const [row] = await sql<{ count: number }[]>`
        select count(*)::int as count from game where table_id = ${tableId}
      `;
      expect(row.count).toBe(2);
      expect((await gameRow(rematch.gameRowId)).seq).toBe(0);
    });
  });

  describe("per-viewer projection over real jsonb", () => {
    it("round-trips state through jsonb and projects a different `you` per seat", async () => {
      const { tableId, players } = await startedGame(2);
      await runtime.applyGameIntent({
        intent: { payload: {}, type: "roll" },
        randomInt: () => 2,
        tableId,
        userId: players[0],
      });

      const first = await runtime.getTableSnapshot({ asUserId: players[0], tableId });
      const second = await runtime.getTableSnapshot({ asUserId: players[1], tableId });

      const firstView = first!.state as Record<string, unknown>;
      const secondView = second!.state as Record<string, unknown>;

      expect(firstView).toMatchObject({ dice: [3, 3, 3, 3, 3], rollsLeft: 2, you: 0 });
      expect(firstView.currentPlayerIndex).toBeUndefined();
      expect({ ...firstView, you: null }).toEqual({ ...secondView, you: null });
    });

    it("replays a real stored log back to the stored state", async () => {
      const { applyYatzyEvent, yatzyModule } = await import("@roundhouse/game-yatzy");
      const { tableId, gameRowId, players } = await startedGame(2);

      for (let step = 0; step < 6; step += 1) {
        await playOneLegalIntent({
          gameRowId,
          randomInt: () => step % 6,
          seatUserIds: players,
          tableId,
        });
      }

      const { state: storedState } = await gameRow(gameRowId);
      const rows = await sql<{ actor_id: string; payload: unknown; type: string }[]>`
        select actor_id, type, payload from game_event where game_row_id = ${gameRowId} order by seq
      `;
      expect(rows.length).toBeGreaterThan(3);

      // Fold from the game's own initial state, rebuilt the way the runtime built it.
      const replayed = rows.reduce(
        (state, row) =>
          applyYatzyEvent(state, {
            actorId: row.actor_id,
            payload: row.payload as never,
            type: row.type,
          }),
        // The runtime seeds the module with the table id, so replay starts there.
        yatzyModule.createInitialState({ ruleset: "yatzy", tableId }, players),
      );

      expect(replayed).toEqual(storedState);
    });
  });
});

class MockSocket {
  readyState = 1;
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private handlers: Record<string, ((value?: unknown) => unknown) | undefined> = {};

  on(event: string, handler: (value?: unknown) => unknown) {
    this.handlers[event] = handler;
    return this;
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  async emitMessage(payload: unknown) {
    await this.handlers.message?.(Buffer.from(JSON.stringify(payload)));
  }

  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }

  frames(): { type: string }[] {
    return this.sent.map((message) => JSON.parse(message));
  }
}
