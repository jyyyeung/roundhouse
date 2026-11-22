import { yatzyModule } from "@roundhouse/game-yatzy";
import { describe, expect, it } from "vitest";

import { createRoomRuntime, SYNC_REPLAY_LIMIT } from "./runtime";
import { createFakeDb, type FakeDbSeed } from "./test-support/fake-db";

const tableId = "table-1";
const playerIds = ["user-a", "user-b"];

function makeSeed() {
  return {
    table: {
      code: "ABC123",
      config: { ruleset: "yatzy", tableId },
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      gameId: "yatzy",
      hostUserId: "user-a",
      id: tableId,
      mode: "live",
      softSeatCap: 4,
      spectatorsAllowed: false,
      status: "active",
    },
    seats: [
      { seatIndex: 0, tableId, userId: "user-a" },
      { seatIndex: 1, tableId, userId: "user-b" },
    ],
    game: {
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      finishedAt: null,
      gameId: "yatzy",
      id: "game-1",
      seq: 0,
      state: yatzyModule.createInitialState({ ruleset: "yatzy", tableId }, playerIds),
      status: "active",
      tableId,
    },
  };
}

function makeRuntime(seed: FakeDbSeed = makeSeed()) {
  const fake = createFakeDb(seed);
  return { ...fake, runtime: createRoomRuntime(fake.db) };
}

describe("room runtime applyGameIntent", () => {
  it("locks the table row before reading game state", async () => {
    const { runtime, calls } = makeRuntime();

    const result = await runtime.applyGameIntent({
      intent: { type: "roll", payload: {} },
      now: () => new Date("2026-11-21T00:00:00.000Z"),
      randomInt: () => 0,
      tableId,
      userId: "user-a",
    });

    expect(result.ok).toBe(true);

    const lockIndex = calls.findIndex((call) => call.op === "execute");
    const gameSelectIndex = calls.findIndex(
      (call) => call.op === "select" && call.table === "game",
    );

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(calls[lockIndex]?.sql).toMatch(/for update/i);
    expect(gameSelectIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(gameSelectIndex);
  });

  it("holds the lock before rejecting an out-of-turn intent", async () => {
    const { runtime, calls } = makeRuntime();

    const result = await runtime.applyGameIntent({
      intent: { type: "roll", payload: {} },
      now: () => new Date("2026-11-21T00:00:00.000Z"),
      randomInt: () => 0,
      tableId,
      userId: "user-b",
    });

    expect(result).toEqual({ code: "illegal_action", message: "not_your_turn", ok: false, seq: 0 });
    expect(calls[0]).toMatchObject({ op: "execute" });
  });

  it("rejects a non-seated actor without writing", async () => {
    const { runtime, calls } = makeRuntime();

    const result = await runtime.applyGameIntent({
      intent: { type: "roll", payload: {} },
      now: () => new Date("2026-11-21T00:00:00.000Z"),
      randomInt: () => 0,
      tableId,
      userId: "user-z",
    });

    expect(result.ok).toBe(false);
    expect(calls.some((call) => call.op === "insert" || call.op === "update")).toBe(false);
  });
});
describe("room runtime intent boundary", () => {
  it("rejects an intent the module never declared", async () => {
    const { runtime, calls } = makeRuntime();

    const result = await runtime.applyGameIntent({
      intent: { payload: {}, type: "dance" },
      now: () => new Date("2026-11-21T00:00:00.000Z"),
      randomInt: () => 0,
      tableId,
      userId: "user-a",
    });

    expect(result).toEqual({ code: "unknown_intent", message: "dance", ok: false, seq: 0 });
    // Nothing was written: the rejection happens before reduce and before any insert.
    expect(calls.some((call) => call.op === "insert" || call.op === "update")).toBe(false);
  });

  it("rejects a declared intent whose payload does not match its schema", async () => {
    const { runtime, calls } = makeRuntime();

    const result = await runtime.applyGameIntent({
      intent: { payload: {}, type: "score" },
      now: () => new Date("2026-11-21T00:00:00.000Z"),
      randomInt: () => 0,
      tableId,
      userId: "user-a",
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("invalid_payload");
    expect(result.ok === false && result.message).toContain("category");
    expect(result.ok === false && result.seq).toBe(0);
    expect(calls.some((call) => call.op === "insert" || call.op === "update")).toBe(false);
  });

  it("still applies a well-formed intent after a rejected one (table not stuck)", async () => {
    const { runtime } = makeRuntime();

    await runtime.applyGameIntent({
      intent: { payload: {}, type: "dance" },
      now: () => new Date("2026-11-21T00:00:00.000Z"),
      randomInt: () => 0,
      tableId,
      userId: "user-a",
    });

    const rolled = await runtime.applyGameIntent({
      intent: { payload: {}, type: "roll" },
      now: () => new Date("2026-11-21T00:00:00.000Z"),
      randomInt: () => 0,
      tableId,
      userId: "user-a",
    });

    expect(rolled.ok).toBe(true);
  });
});

describe("room runtime sync", () => {
  function syncSeed(input: { seq: number; events?: Record<string, unknown>[] }) {
    const seed = makeSeed();
    return {
      ...seed,
      game: { ...seed.game, seq: input.seq },
      gameEvents: input.events ?? [],
    };
  }

  function eventRow(seq: number) {
    return {
      actorId: "user-a",
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      gameId: "game-1",
      gameRowId: "game-1",
      id: `event-${seq}`,
      payload: { seq },
      seq,
      tableId,
      type: "dice_rolled",
    };
  }

  it("replays exactly the events a client missed", async () => {
    const { runtime } = makeRuntime(
      syncSeed({ events: [eventRow(1), eventRow(2)], seq: 2 }) as never,
    );

    const sync = await runtime.getTableSync({ asUserId: "user-a", sinceSeq: 0, tableId });

    expect(sync).toMatchObject({
      fromSeq: 0,
      kind: "events",
      toSeq: 2,
    });
    expect(sync?.kind === "events" && sync.events.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("answers a current client with no events at all", async () => {
    const { runtime } = makeRuntime(syncSeed({ seq: 2 }) as never);

    const sync = await runtime.getTableSync({ asUserId: "user-a", sinceSeq: 2, tableId });

    expect(sync).toMatchObject({ events: [], fromSeq: 2, kind: "events", toSeq: 2 });
  });

  it("falls back to a snapshot when the gap exceeds the replay budget", async () => {
    const { runtime } = makeRuntime(syncSeed({ seq: SYNC_REPLAY_LIMIT + 1 }) as never);

    const sync = await runtime.getTableSync({ asUserId: "user-a", sinceSeq: 0, tableId });

    expect(sync).toMatchObject({ kind: "snapshot", seq: SYNC_REPLAY_LIMIT + 1, tableId });
  });

  it("falls back to a snapshot when the replay has a hole in it", async () => {
    // seq says three events happened, the log only holds two: replaying would
    // leave the client silently misaligned, so it gets the state instead.
    const { runtime } = makeRuntime(
      syncSeed({ events: [eventRow(1), eventRow(2)], seq: 3 }) as never,
    );

    const sync = await runtime.getTableSync({ asUserId: "user-a", sinceSeq: 0, tableId });

    expect(sync?.kind).toBe("snapshot");
  });

  it("reports a missing table as null rather than inventing state", async () => {
    const { runtime } = makeRuntime({ game: null, seats: [], table: null } as never);

    const sync = await runtime.getTableSync({ asUserId: "user-a", sinceSeq: 0, tableId: "nope" });

    expect(sync).toBeNull();
  });

  it("exposes live state so an HTTP mutation can push a snapshot", async () => {
    const { runtime } = makeRuntime(syncSeed({ seq: 4 }) as never);

    const live = await runtime.getTableLiveState({ tableId });

    expect(live).toMatchObject({ seq: 4, tableId });
    expect(live?.state).not.toBeNull();
    expect(live?.meta.seatUserIds).toEqual(playerIds);
  });
});

describe("room runtime per-viewer projection", () => {
  it("gives two seated players snapshots differing only in `you`", async () => {
    const { runtime } = makeRuntime();

    const first = await runtime.getTableSnapshot({ asUserId: "user-a", tableId });
    const second = await runtime.getTableSnapshot({ asUserId: "user-b", tableId });

    const firstView = first?.state as Record<string, unknown>;
    const secondView = second?.state as Record<string, unknown>;

    expect(firstView.you).toBe(0);
    expect(secondView.you).toBe(1);
    expect({ ...firstView, you: null }).toEqual({ ...secondView, you: null });
  });

  it("never puts the stored state on the wire", async () => {
    const { runtime } = makeRuntime();

    const snapshot = await runtime.getTableSnapshot({ asUserId: "user-a", tableId });
    const view = snapshot?.state as Record<string, unknown>;

    // currentPlayerIndex / tableId / bonus bookkeeping live in the jsonb, not in
    // the view: the client sees a turn id, never a seat index it could poke.
    expect(view.currentPlayerIndex).toBeUndefined();
    expect(view.tableId).toBeUndefined();
    expect(Object.keys(view).sort()).toEqual([
      "currentPlayerId",
      "dice",
      "gameId",
      "holds",
      "phase",
      "playerIds",
      "rollsLeft",
      "ruleset",
      "sheets",
      "winnerIds",
      "you",
    ]);
  });

  it("gives a non-seat an anonymous board", async () => {
    const { runtime } = makeRuntime();

    const snapshot = await runtime.getTableSnapshot({ asUserId: "user-z", tableId });

    const view = snapshot?.state as Record<string, unknown>;
    expect(view.you).toBeNull();
    expect(view.currentPlayerId).toBe("user-a");
  });
});

describe("room runtime seat and config enforcement", () => {
  function createdTable(calls: { op: string; table?: string; row?: Record<string, unknown> }[]) {
    return calls.find((call) => call.op === "insert" && call.table === "game_table")?.row;
  }

  it("defaults the seat cap to the module's own maximum", async () => {
    // yatzy seats 2-6, so an untouched table may fill to six. The old default of
    // four was a table-layer guess at a game-layer fact.
    const { runtime, calls } = makeRuntime();

    await runtime.createTable({
      config: { ruleset: "yatzy" },
      gameId: "yatzy",
      userId: "user-a",
    });

    expect(createdTable(calls)).toMatchObject({ softSeatCap: 6, gameId: "yatzy" });
  });

  it("refuses a seat cap the module cannot seat", async () => {
    const { runtime, calls } = makeRuntime();

    await expect(
      runtime.createTable({
        config: { ruleset: "yatzy" },
        gameId: "yatzy",
        softSeatCap: 9,
        userId: "user-a",
      }),
    ).rejects.toMatchObject({
      code: "invalid_seat_cap",
      message: "yatzy seats 2-6 players, not 9",
    });
    expect(createdTable(calls)).toBeUndefined();
  });

  it("refuses a config the module's schema rejects", async () => {
    const { runtime, calls } = makeRuntime();

    await expect(
      runtime.createTable({
        config: { ruleset: "poker" },
        gameId: "yatzy",
        userId: "user-a",
      }),
    ).rejects.toMatchObject({ code: "invalid_config" });
    expect(createdTable(calls)).toBeUndefined();
  });

  it("stores the config in the shape the module normalised, not the caller's", async () => {
    const { runtime, calls } = makeRuntime();

    // zod strips keys the module never declared, so a stray field cannot ride
    // into the row and surprise the module later.
    await runtime.createTable({
      config: { ruleset: "yahtzee", surprise: true },
      gameId: "yatzy",
      userId: "user-a",
    });

    expect(createdTable(calls)).toMatchObject({ config: { ruleset: "yahtzee" } });
  });

  /** A table still in the lobby: `startTable` returns early for an active game. */
  function lobbyWithSeats(seatCount: number) {
    const seed = makeSeed();
    return {
      ...seed,
      game: null,
      seats: Array.from({ length: seatCount }, (_unused, seatIndex) => ({
        seatIndex,
        tableId,
        userId: seatIndex === 0 ? "user-a" : `user-${seatIndex}`,
      })),
      table: { ...seed.table, softSeatCap: 6, status: "lobby" },
    };
  }

  it("refuses to start with fewer players than the module needs", async () => {
    const { runtime } = makeRuntime(lobbyWithSeats(1));

    await expect(runtime.startTable({ tableId, userId: "user-a" })).rejects.toMatchObject({
      code: "not_enough_players",
    });
  });

  it("refuses to start with more players than the module can seat", async () => {
    // Seven seats cannot exist through `joinTable` (the cap is six), but a
    // seat-cap change or a direct row could produce one, and the module is the
    // authority on what it can run.
    const { runtime } = makeRuntime(lobbyWithSeats(7));

    await expect(runtime.startTable({ tableId, userId: "user-a" })).rejects.toMatchObject({
      code: "too_many_players",
    });
  });
});

describe("room runtime lobby list", () => {
  it("summarises a table without shipping its stored game state", async () => {
    const { runtime } = makeRuntime();

    const [row] = await runtime.getMine({ userId: "user-a" });

    // The lobby needs membership and progress; it must never receive the board.
    // `getMine` used to hand back the whole `currentGame` row, jsonb state
    // included, which per-viewer projection exists to prevent.
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("currentGame");
    expect(Object.keys(row ?? {})).not.toContain("state");
    expect(JSON.stringify(row)).not.toContain("sheets");
    expect(row?.seatUserIds).toEqual(playerIds);
    expect(row?.seats).toHaveLength(2);
    expect(row?.status).toBe("active");
  });
});

function lobbySeed(seatUserIds: string[]) {
  return {
    game: null,
    seats: seatUserIds.map((userId, index) => ({ seatIndex: index, tableId, userId })),
    table: {
      code: "ABC123",
      config: { ruleset: "yatzy", tableId },
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      gameId: "yatzy",
      hostUserId: seatUserIds[0],
      id: tableId,
      mode: "live",
      softSeatCap: 4,
      spectatorsAllowed: false,
      status: "lobby",
    },
  };
}

function seatWrites(calls: { op: string; row?: Record<string, unknown> }[]) {
  return calls
    .filter((call) => call.op === "update" || call.op === "delete")
    .map((call) => `${call.op}:${call.row?.seatIndex ?? ""}`);
}

describe("room runtime leaving a table", () => {
  it("locks the table before it writes anything", async () => {
    const { runtime, calls } = makeRuntime(lobbySeed(["user-a", "user-b"]));

    await runtime.leaveTable({ tableId, userId: "user-b" });

    expect(calls[0]).toMatchObject({ op: "execute" });
    expect(calls[0]?.sql).toMatch(/for update/i);
  });

  it("renumbers the survivors into a contiguous seat list", async () => {
    const { runtime, calls } = makeRuntime(lobbySeed(["user-a", "user-b", "user-c"]));

    const result = await runtime.leaveTable({ tableId, userId: "user-b" });

    expect(result).toMatchObject({
      hostUserId: "user-a",
      removed: true,
      seatsRemaining: 2,
      tableDeleted: false,
    });
    // Two passes: park outside the live range, then place contiguous. A single
    // pass collides on (tableId, seatIndex) with the row still holding seat 1.
    expect(
      calls
        .filter((call) => call.op === "update" && call.table === "table_player")
        .map((call) => call.row?.seatIndex),
    ).toEqual([-1, -2, 0, 1]);
    expect(calls.some((call) => call.op === "update" && call.table === "game_table")).toBe(false);
  });

  it("hands the table to the lowest remaining seat when the host leaves", async () => {
    const { runtime, calls } = makeRuntime(lobbySeed(["user-a", "user-b", "user-c"]));

    const result = await runtime.leaveTable({ tableId, userId: "user-a" });

    expect(result.hostUserId).toBe("user-b");
    expect(calls.find((call) => call.op === "update" && call.table === "game_table")?.row).toEqual({
      hostUserId: "user-b",
    });
  });

  it("deletes the table when the last player leaves", async () => {
    const { runtime, calls } = makeRuntime(lobbySeed(["user-a"]));

    const result = await runtime.leaveTable({ tableId, userId: "user-a" });

    expect(result).toMatchObject({ hostUserId: null, seatsRemaining: 0, tableDeleted: true });
    expect(calls.some((call) => call.op === "delete" && call.table === "game_table")).toBe(true);
    // No survivors to renumber.
    expect(calls.some((call) => call.op === "update")).toBe(false);
  });

  it("is idempotent: leaving a table you are not seated at changes nothing", async () => {
    const { runtime, calls } = makeRuntime(lobbySeed(["user-a", "user-b"]));

    const result = await runtime.leaveTable({ tableId, userId: "user-z" });

    expect(result).toMatchObject({ removed: false, seatsRemaining: 2, tableDeleted: false });
    expect(seatWrites(calls)).toEqual([]);
  });

  it("succeeds when the table is already gone", async () => {
    const { runtime } = makeRuntime({ seats: [], table: null });

    const result = await runtime.leaveTable({ tableId, userId: "user-a" });

    expect(result).toMatchObject({ removed: false, seatsRemaining: 0, tableDeleted: true });
  });

  it("refuses to leave a table whose game is still running", async () => {
    const { runtime, calls } = makeRuntime({
      ...makeSeed(),
      table: { ...makeSeed().table, status: "active" },
    });

    await expect(runtime.leaveTable({ tableId, userId: "user-b" })).rejects.toMatchObject({
      code: "game_in_progress",
    });
    expect(seatWrites(calls)).toEqual([]);
  });
});

describe("room runtime kicking a player", () => {
  it("refuses a host that is not the host", async () => {
    const { runtime, calls } = makeRuntime(lobbySeed(["user-a", "user-b"]));
    const host = "user-b";

    await expect(
      runtime.kickTablePlayer({ hostUserId: host, tableId, targetUserId: "user-a" }),
    ).rejects.toMatchObject({ code: "not_host", status: 403 });
    expect(seatWrites(calls)).toEqual([]);
  });

  it("tells the host to leave instead of kicking themselves", async () => {
    const { runtime } = makeRuntime(lobbySeed(["user-a", "user-b"]));

    await expect(
      runtime.kickTablePlayer({ hostUserId: "user-a", tableId, targetUserId: "user-a" }),
    ).rejects.toMatchObject({ code: "host_must_leave" });
  });

  it("404s for someone who is not seated", async () => {
    const { runtime } = makeRuntime(lobbySeed(["user-a", "user-b"]));

    await expect(
      runtime.kickTablePlayer({ hostUserId: "user-a", tableId, targetUserId: "user-z" }),
    ).rejects.toMatchObject({ code: "not_seated", status: 404 });
  });

  it("removes the seat and renumbers the survivors", async () => {
    const { runtime, calls } = makeRuntime(lobbySeed(["user-a", "user-b", "user-c"]));

    const result = await runtime.kickTablePlayer({
      hostUserId: "user-a",
      tableId,
      targetUserId: "user-b",
    });

    expect(result).toMatchObject({ hostUserId: "user-a", seatsRemaining: 2 });
    expect(
      calls
        .filter((call) => call.op === "update" && call.table === "table_player")
        .map((call) => call.row?.seatIndex),
    ).toEqual([-1, -2, 0, 1]);
  });

  it("refuses to kick while the game is live", async () => {
    const { runtime } = makeRuntime({
      ...makeSeed(),
      table: { ...makeSeed().table, status: "active" },
    });

    await expect(
      runtime.kickTablePlayer({ hostUserId: "user-a", tableId, targetUserId: "user-b" }),
    ).rejects.toMatchObject({ code: "game_in_progress" });
  });
});
