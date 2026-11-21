import { yatzyModule } from "@roundhouse/game-yatzy";
import { describe, expect, it } from "vitest";

import { createRoomRuntime } from "./runtime";
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
