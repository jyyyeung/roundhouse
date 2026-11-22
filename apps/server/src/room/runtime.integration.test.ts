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

import type { Json } from "@roundhouse/game-core";
import { type DuelState, duelModule } from "@roundhouse/game-duel";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { schema, user } from "../db/schema";
import { assertDisposableDatabase } from "../test/assert-disposable-database";
import { createRoomRuntime, TablesError } from "./runtime";

const testUrl = process.env.DATABASE_URL_TEST;

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

  async function makeTable(
    host: string,
    options: { config?: Json; gameId?: string; softSeatCap?: number } = {},
  ) {
    return runtime.createTable({
      config: options.config ?? { ruleset: "yatzy" },
      gameId: options.gameId ?? "yatzy",
      // Undefined means "the game decides" — the runtime defaults to playerCount.max.
      softSeatCap: options.softSeatCap,
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
      // Yatzy seats at most six, so the races fill the whole table it declares.
      const { tableId, code } = await makeTable(host, { softSeatCap: 6 });
      const joiners = await Promise.all(Array.from({ length: 5 }, () => makeUser()));

      const results = await Promise.all(
        joiners.map((player) => runtime.joinTable({ code, userId: player })),
      );

      expect(results.every((result) => result.tableId === tableId)).toBe(true);

      const seats = await sql<{ seat_index: number }[]>`
        select seat_index from table_player where table_id = ${tableId} order by seat_index
      `;
      // The host took seat 0, so five joiners land on 1..5.
      expect(seats.map((row) => row.seat_index)).toEqual([0, 1, 2, 3, 4, 5]);
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

    it("refuses a seat cap the game cannot play", async () => {
      // Formerly a known gap: create accepted cap 1 and the table could never
      // start. The module's playerCount now bounds the cap at create time, so the
      // mistake surfaces where it is made.
      const host = await makeUser();

      await expectTablesError(makeTable(host, { softSeatCap: 1 }), "invalid_seat_cap");
      await expectTablesError(makeTable(host, { softSeatCap: 9 }), "invalid_seat_cap");
    });

    it("defaults the cap to the game's maximum", async () => {
      const host = await makeUser();
      const { tableId } = await makeTable(host);

      const [row] = await sql<{ soft_seat_cap: number }[]>`
        select soft_seat_cap from game_table where id = ${tableId}
      `;
      expect(row.soft_seat_cap).toBe(6);
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

  describe("a secret-pick duel over real jsonb", () => {
    async function startedDuel(config?: Json) {
      const players = await Promise.all([makeUser(), makeUser()]);
      const table = await makeTable(players[0], { config, gameId: "duel" });
      for (const player of players.slice(1)) {
        await runtime.joinTable({ code: table.code, userId: player });
      }
      const started = await runtime.startTable({ tableId: table.tableId, userId: players[0] });
      return { ...table, gameRowId: started.gameRowId, players };
    }

    async function pick(input: { tableId: string; userId: string; card: string }) {
      return runtime.applyGameIntent({
        intent: { payload: { card: input.card }, type: "play" },
        randomInt: () => 0,
        tableId: input.tableId,
        userId: input.userId,
      });
    }

    it("keeps a pending pick out of every viewer's snapshot but its owner's", async () => {
      const duel = await startedDuel();
      const [alice, bob] = duel.players as [string, string];

      await pick({ card: "strike", tableId: duel.tableId, userId: alice });

      // The stored row really does hold the secret: this is the state the
      // projection has to hide, not a state that never contained it.
      const { state } = await gameRow(duel.gameRowId);
      expect((state as unknown as DuelState).pending).toEqual({ [alice]: "strike" });

      const aliceSnapshot = await runtime.getTableSnapshot({
        asUserId: alice,
        tableId: duel.tableId,
      });
      const bobSnapshot = await runtime.getTableSnapshot({ asUserId: bob, tableId: duel.tableId });
      const spectatorSnapshot = await runtime.getTableSnapshot({
        asUserId: null,
        tableId: duel.tableId,
      });

      expect(JSON.stringify(aliceSnapshot?.state)).toContain('"yourPick":"strike"');
      expect(JSON.stringify(bobSnapshot?.state)).not.toContain("strike");
      expect(JSON.stringify(spectatorSnapshot?.state)).not.toContain("strike");
      // Tempo is public: bob can see that alice has committed.
      expect(JSON.stringify(bobSnapshot?.state)).toContain(`"pickedBy":["${alice}"]`);
    });

    it("never writes the card to the event log before the round resolves", async () => {
      const duel = await startedDuel();
      const [alice, bob] = duel.players as [string, string];

      await pick({ card: "strike", tableId: duel.tableId, userId: alice });

      const rows = await sql<{ payload: Record<string, unknown>; type: string }[]>`
        select type, payload from game_event where game_row_id = ${duel.gameRowId} order by seq
      `;
      expect(rows.map((row) => row.type)).toEqual(["duel_picked"]);
      // Events are broadcast unprojected (finding F2), so the secret must not be
      // in the frame a pick produces either.
      expect(rows[0]?.payload).toEqual({ playerId: alice });

      await pick({ card: "guard", tableId: duel.tableId, userId: bob });
      const after = await sql<{ payload: Record<string, unknown>; type: string }[]>`
        select type, payload from game_event where game_row_id = ${duel.gameRowId} order by seq
      `;
      expect(after.map((row) => row.type)).toEqual(["duel_picked", "duel_round"]);
      // The reveal carries both cards, in seat order, to everyone. The second
      // player's pick is never a separate event: it arrives already revealed.
      const reveal = after[1]?.payload as { plays: { card: string }[] } | undefined;
      expect(reveal?.plays.map((play) => play.card)).toEqual(["strike", "guard"]);
    });

    it("plays a full match to a winner and reproduces the final state from the log", async () => {
      const duel = await startedDuel({ rounds: 2, tableId: "ignored-by-runtime" });
      const [alice, bob] = duel.players as [string, string];

      // Alice wins both rounds: strike beats feint, guard beats strike.
      for (const [aliceCard, bobCard] of [
        ["strike", "feint"],
        ["guard", "strike"],
      ] as const) {
        await pick({ card: aliceCard, tableId: duel.tableId, userId: alice });
        const resolution = await pick({ card: bobCard, tableId: duel.tableId, userId: bob });
        expect(resolution.ok).toBe(true);
      }

      const { seq, state } = await gameRow(duel.gameRowId);
      const finished = state as unknown as DuelState;

      expect(finished.phase).toBe("finished");
      expect(finished.winnerIds).toEqual([alice]);
      expect(finished.decidedBy).toBe("rounds");
      expect(finished.scores).toEqual({ [alice]: 2, [bob]: 0 });
      // Per round: one `duel_picked` for the first seat (no card) and one
      // `duel_round` for the reveal. Two rounds plus the finish is five events,
      // and the game row's seq is that count.
      expect(seq).toBe(5);
      expect(await eventSeqs(duel.gameRowId)).toEqual([1, 2, 3, 4, 5]);

      const statusRow = await sql<
        { status: string }[]
      >`select status from game where id = ${duel.gameRowId}`;
      expect(statusRow[0]?.status).toBe("finished");

      // Invariant I3 over the real rows: folding the stored log reproduces the
      // stored state, whatever Postgres did to the jsonb on the way in and out.
      const events = await sql<{ payload: unknown; type: string }[]>`
        select type, payload from game_event where game_row_id = ${duel.gameRowId} order by seq
      `;
      const replayed = events.reduce<Json>(
        (current, event, index) =>
          duelModule.applyEvent(current, {
            actorId: alice,
            createdAt: new Date(0).toISOString(),
            gameId: "duel",
            id: `replay-${index}`,
            payload: event.payload as Json,
            seq: index + 1,
            tableId: duel.tableId,
            type: event.type,
          }),
        duelModule.createInitialState({ rounds: 2, tableId: duel.tableId }, duel.players),
      );
      expect(replayed).toEqual(finished);
    });

    it("breaks a level match with one server draw that the log can replay", async () => {
      const duel = await startedDuel({ rounds: 1 });
      const [alice, bob] = duel.players as [string, string];

      // A clash scores nothing, so one round of it leaves the match level with no
      // rounds left: the only way to finish is the server's draw.
      await pick({ card: "guard", tableId: duel.tableId, userId: alice });
      await runtime.applyGameIntent({
        intent: { payload: { card: "guard" }, type: "play" },
        randomInt: () => 1,
        tableId: duel.tableId,
        userId: bob,
      });

      const { state } = await gameRow(duel.gameRowId);
      const resolved = state as unknown as DuelState;
      expect(resolved.scores).toEqual({ [alice]: 0, [bob]: 0 });
      expect(resolved.decidedBy).toBe("roll");
      expect(resolved.decisiveRoll).toEqual({ roll: 1, winnerId: bob });
      expect(resolved.winnerIds).toEqual([bob]);

      // The draw is in the log, so replaying it picks the same winner instead of
      // re-rolling (the reason `decisiveRoll` is state at all).
      const events = await sql<{ payload: unknown; type: string }[]>`
        select type, payload from game_event where game_row_id = ${duel.gameRowId} order by seq
      `;
      expect(events.map((event) => event.type)).toEqual([
        "duel_picked",
        "duel_round",
        "duel_decided",
        "game_finished",
      ]);
    });
  });

  describe("leaving and kicking (M1-2, #44)", () => {
    async function seatRows(tableId: string) {
      return sql<{ seat_index: number; user_id: string }[]>`
        select seat_index, user_id from table_player
        where table_id = ${tableId} order by seat_index
      `;
    }

    async function tableCount(tableId: string) {
      const [row] = await sql<{ count: number }[]>`
        select count(*)::int as count from game_table where id = ${tableId}
      `;
      return row.count;
    }

    it("compacts the seats when a middle player leaves", async () => {
      const seats = await seatTable(3);
      const [host, middle, last] = seats.players;

      const result = await runtime.leaveTable({ tableId: seats.tableId, userId: middle });

      expect(result).toMatchObject({ hostUserId: host, removed: true, seatsRemaining: 2 });
      // The seat list is a position, not a set: `last` must move from 2 to 1 or
      // every module that reads a seat index sees a hole where `middle` was.
      expect(await seatRows(seats.tableId)).toEqual([
        { seat_index: 0, user_id: host },
        { seat_index: 1, user_id: last },
      ]);
      const snapshot = await runtime.getTableSnapshot({ asUserId: host, tableId: seats.tableId });
      expect(snapshot?.meta.seatUserIds).toEqual([host, last]);
    });

    it("hands the host role to the lowest remaining seat", async () => {
      const seats = await seatTable(3);
      const [host, next, last] = seats.players;

      await runtime.leaveTable({ tableId: seats.tableId, userId: host });

      const snapshot = await runtime.getTableSnapshot({ asUserId: next, tableId: seats.tableId });
      expect(snapshot?.meta.hostUserId).toBe(next);
      expect(snapshot?.meta.seatUserIds).toEqual([next, last]);
      // A seated table is never hostless, so the new host can actually start it.
      await expect(
        runtime.startTable({ tableId: seats.tableId, userId: next }),
      ).resolves.toMatchObject({ tableId: seats.tableId });
    });

    it("deletes the table and frees its invite code when the last player leaves", async () => {
      const seats = await seatTable(1);

      const result = await runtime.leaveTable({
        tableId: seats.tableId,
        userId: seats.players[0],
      });

      expect(result).toMatchObject({ hostUserId: null, seatsRemaining: 0, tableDeleted: true });
      expect(await tableCount(seats.tableId)).toBe(0);
      expect(await seatRows(seats.tableId)).toEqual([]);
      const [codeRow] = await sql<{ count: number }[]>`
        select count(*)::int as count from game_table where code = ${seats.code}
      `;
      expect(codeRow.count).toBe(0);
      expect(await runtime.getTableSnapshot({ asUserId: null, tableId: seats.tableId })).toBeNull();
      // The code is truly free: a stale invite link finds nothing to join.
      await expect(
        runtime.joinTable({ code: seats.code, userId: await makeUser() }),
      ).rejects.toMatchObject({ code: "unknown_table" });
    });

    it("is idempotent: leaving twice changes nothing the second time", async () => {
      const seats = await seatTable(2);
      const leaver = seats.players[1];

      await runtime.leaveTable({ tableId: seats.tableId, userId: leaver });
      const second = await runtime.leaveTable({ tableId: seats.tableId, userId: leaver });

      expect(second).toMatchObject({ removed: false, seatsRemaining: 1, tableDeleted: false });
      expect(await seatCount(seats.tableId)).toBe(1);
    });

    it("removes a kicked player's seat and keeps the survivors contiguous", async () => {
      const seats = await seatTable(3);
      const [host, kicked, last] = seats.players;

      await runtime.kickTablePlayer({
        hostUserId: host,
        tableId: seats.tableId,
        targetUserId: kicked,
      });

      expect(await seatRows(seats.tableId)).toEqual([
        { seat_index: 0, user_id: host },
        { seat_index: 1, user_id: last },
      ]);
      // The kicked player's next subscribe is refused by the seat check.
      await expect(
        runtime.getTableSnapshot({ asUserId: host, tableId: seats.tableId }),
      ).resolves.toMatchObject({ meta: { seatUserIds: [host, last] } });
    });

    it("refuses a kick from someone who is not the host, and changes nothing", async () => {
      const seats = await seatTable(3);
      const [, guest, target] = seats.players;

      await expectTablesError(
        runtime.kickTablePlayer({
          hostUserId: guest,
          tableId: seats.tableId,
          targetUserId: target,
        }),
        "not_host",
      );
      expect(await seatCount(seats.tableId)).toBe(3);
    });

    it("refuses to leave or kick while the game is running", async () => {
      const seats = await startedGame(2);
      const [host, guest] = seats.players;

      await expectTablesError(
        runtime.leaveTable({ tableId: seats.tableId, userId: guest }),
        "game_in_progress",
      );
      await expectTablesError(
        runtime.kickTablePlayer({
          hostUserId: host,
          tableId: seats.tableId,
          targetUserId: guest,
        }),
        "game_in_progress",
      );
      expect(await seatCount(seats.tableId)).toBe(2);
    });

    it("keeps seats contiguous when a leave races two joins", async () => {
      const seats = await seatTable(3, { softSeatCap: 3 });
      const [, leaver] = seats.players;
      const joiners = await Promise.all([makeUser(), makeUser()]);

      // Same table row, three transactions: the lock is what keeps the
      // (tableId, seatIndex) unique index from being violated.
      const results = await Promise.allSettled([
        runtime.leaveTable({ tableId: seats.tableId, userId: leaver }),
        ...joiners.map((userId) => runtime.joinTable({ code: seats.code, userId })),
      ]);

      expect(results[0]).toMatchObject({ status: "fulfilled" });
      for (const result of results.slice(1)) {
        if (result.status === "rejected") {
          expect(result.reason).toMatchObject({ code: "table_full" });
        }
      }

      const rows = await seatRows(seats.tableId);
      expect(rows.map((row) => row.seat_index)).toEqual(rows.map((_, index) => index));
      expect(rows.some((row) => row.user_id === leaver)).toBe(false);
      expect(rows.length).toBeLessThanOrEqual(3);
    });

    it("allows leaving once the game is over", async () => {
      const seats = await startedGame(2);
      const [host, guest] = seats.players;
      await sql`update game set status = 'finished', finished_at = now() where table_id = ${seats.tableId}`;

      const result = await runtime.leaveTable({ tableId: seats.tableId, userId: guest });

      expect(result).toMatchObject({ removed: true, seatsRemaining: 1, hostUserId: host });
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

  describe("serving a finished game as a replay (M2-2, #57)", () => {
    async function statusOf(gameRowId: string) {
      const [row] = await sql<{ status: string }[]>`
        select status from game where id = ${gameRowId}
      `;
      return row.status;
    }

    /** Plays the table out with legal intents until the game row says finished. */
    async function finishedGame(playerCount = 2) {
      const game = await startedGame(playerCount);
      for (let step = 0; step < 200; step += 1) {
        if ((await statusOf(game.gameRowId)) === "finished") return game;
        await playOneLegalIntent({
          gameRowId: game.gameRowId,
          randomInt: () => step % 6,
          seatUserIds: game.players,
          tableId: game.tableId,
        });
      }
      throw new Error("the scripted game never finished");
    }

    it("serves projected steps that end on the board the table shows", async () => {
      const { tableId, players } = await finishedGame();

      const ann = await runtime.getTableReplay({ asUserId: players[0], tableId });
      const bob = await runtime.getTableReplay({ asUserId: players[1], tableId });
      const live = await runtime.getTableSnapshot({ asUserId: players[0], tableId });

      expect(ann.meta.status).toBe("finished");
      expect(ann.turns.length).toBeGreaterThan(10);
      // One step per recorded event: the opening board is the game row, not a step.
      expect(ann.turns[0]).toMatchObject({ actorId: players[0], seq: 1 });
      expect(ann.turns.at(-1)?.view).toEqual(live?.state);

      // A step carries a phrase and a projected view — never an event payload.
      for (const turn of ann.turns) {
        expect(Object.keys(turn).sort()).toEqual(["actorId", "phrase", "seq", "view"]);
        expect(turn.view).not.toHaveProperty("currentPlayerIndex");
        expect(turn.phrase).not.toMatch(/^[a-z]+_[a-z]+$/);
      }

      const seqs = ann.turns.map((turn) => turn.seq);
      expect([...seqs].sort((left, right) => left - right)).toEqual(seqs);

      const annLast = ann.turns.at(-1)?.view as Record<string, unknown>;
      const bobLast = bob.turns.at(-1)?.view as Record<string, unknown>;
      expect(annLast.you).toBe(0);
      expect(bobLast.you).toBe(1);
      expect({ ...annLast, you: null }).toEqual({ ...bobLast, you: null });
    });

    it("refuses an unfinished game and a table that does not exist", async () => {
      const { tableId, players } = await startedGame(2);

      await expectTablesError(
        runtime.getTableReplay({ asUserId: players[0], tableId }),
        "table_not_finished",
      );
      await expectTablesError(
        runtime.getTableReplay({ asUserId: players[0], tableId: "no-such-table" }),
        "table_missing",
      );
    });

    it("refuses an outsider and a log with a hole rather than inventing steps", async () => {
      const { gameRowId, tableId, players } = await finishedGame();
      const outsider = await makeUser();

      await expectTablesError(
        runtime.getTableReplay({ asUserId: outsider, tableId }),
        "not_a_participant",
      );

      await sql`
        delete from game_event
        where game_row_id = ${gameRowId}
          and seq = (select max(seq) from game_event where game_row_id = ${gameRowId})
      `;

      await expectTablesError(
        runtime.getTableReplay({ asUserId: players[0], tableId }),
        "replay_unavailable",
      );
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
