import { yatzyModule } from "@roundhouse/game-yatzy";
import { describe, expect, it } from "vitest";

import { createRoomRuntime, SYNC_REPLAY_LIMIT } from "./runtime";
import { createFakeDb } from "./test-support/fake-db";

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

function makeRuntime(seed = makeSeed()) {
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
    const gameSelectIndex = calls.findIndex((call) => call.op === "select" && call.table === "game");

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
