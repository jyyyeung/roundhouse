import type {
  ClientTableMessage,
  EventEnvelope,
  Json,
  RawGameState,
  ServerMessage,
  TableMeta,
} from "@roundhouse/game-core";
import { yatzyModule } from "@roundhouse/game-yatzy";
import { describe, expect, it } from "vitest";

import { createWsHandlers, type WsRuntime } from "./handlers";

function makeRuntime(): WsRuntime {
  const tableId = "table-1";
  const playerIds = ["user-a", "user-b"];
  const meta: TableMeta = {
    code: "ABC123",
    gameId: "yatzy",
    config: { ruleset: "yatzy", tableId },
    status: "active",
    hostUserId: "user-a",
    seatUserIds: playerIds,
    softSeatCap: 4,
  };

  let seq = 0;
  let state = yatzyModule.createInitialState(meta.config, playerIds);

  return {
    async getTableSnapshot(input) {
      if (input.tableId !== tableId) return null;
      return { tableId, meta, seq, state };
    },
    async applyGameIntent({ tableId: nextTableId, userId, intent }) {
      if (nextTableId !== tableId) {
        return { ok: false, code: "table_missing", message: "table_missing", seq };
      }

      const result = yatzyModule.reduce(state, intent, {
        actorId: userId,
        now: () => new Date("2026-08-02T00:00:00.000Z"),
        playerIds,
        randomInt: () => 0,
      });

      if (!result.ok) {
        return { ok: false, code: "illegal_action", message: result.error, seq };
      }

      state = result.state;
      const events = result.events.map<EventEnvelope>((event, index) => ({
        ...event,
        id: `event-${seq + index + 1}`,
        seq: seq + index + 1,
        createdAt: "2026-08-02T00:00:00.000Z",
      }));
      seq += events.length;

      return {
        ok: true,
        events,
        finished: yatzyModule.isFinished(state),
        meta,
        seq,
        state: state as unknown as RawGameState,
      };
    },
  };
}

describe("ws handlers", () => {
  it("returns illegal_action and leaves seq unchanged for out-of-turn intents", async () => {
    const sent: ServerMessage[] = [];
    const published: ServerMessage[] = [];
    const runtime = makeRuntime();
    const handlers = createWsHandlers({
      runtime,
      publishApplied: () => {},
      isDuplicateAction: () => false,
      rememberAction: () => {},
      forgetAction: () => {},
      publishToTable: (_tableId, message) => {
        published.push(message);
      },
    });

    await handlers.onMessage(
      {
        send(message) {
          sent.push(message);
        },
        userId: "user-b",
      },
      {
        actionId: "action-1",
        intentType: "roll",
        payload: {} satisfies Json,
        tableId: "table-1",
        type: "intent",
        v: 2,
      },
    );

    expect(sent).toEqual([
      {
        actionId: "action-1",
        code: "illegal_action",
        message: "not_your_turn",
        tableId: "table-1",
        type: "error",
        v: 2,
      },
    ]);
    expect(published).toEqual([]);

    const snapshot = await runtime.getTableSnapshot({ asUserId: null, tableId: "table-1" });
    expect(snapshot?.seq).toBe(0);
  });

  it("dedupes second identical actionId when reserved", async () => {
    const sent: ServerMessage[] = [];
    const published: ServerMessage[] = [];
    const runtimeBase = makeRuntime();
    let applyCalls = 0;
    const runtime: WsRuntime = {
      ...runtimeBase,
      async applyGameIntent(input) {
        applyCalls++;
        return await runtimeBase.applyGameIntent(input);
      },
    };

    const actionIds = new Set<string>();
    const handlers = createWsHandlers({
      runtime,
      publishApplied: () => {},
      isDuplicateAction: (_tableId, actionId) => actionIds.has(actionId),
      rememberAction: (_tableId, actionId) => actionIds.add(actionId),
      forgetAction: (_tableId, actionId) => actionIds.delete(actionId),
      publishToTable: (_tableId, message) => {
        published.push(message);
      },
    });

    await handlers.onMessage(
      {
        send(message) {
          sent.push(message);
        },
        userId: "user-a",
      },
      {
        actionId: "action-dup",
        intentType: "roll",
        payload: {} satisfies Json,
        tableId: "table-1",
        type: "intent",
        v: 2,
      },
    );

    // second identical message should be ignored (deduped)
    await handlers.onMessage(
      {
        send() {},
        userId: "user-a",
      },
      {
        actionId: "action-dup",
        intentType: "roll",
        payload: {} satisfies Json,
        tableId: "table-1",
        type: "intent",
        v: 2,
      },
    );

    expect(applyCalls).toBe(1);
  });

  it("clears reservation on illegal_action so retry can proceed", async () => {
    const sent: ServerMessage[] = [];
    const published: ServerMessage[] = [];
    const runtimeBase = makeRuntime();
    let calls = 0;
    const runtime: WsRuntime = {
      ...runtimeBase,
      async applyGameIntent(input) {
        calls++;
        if (calls === 1) {
          return { ok: false, code: "illegal_action", message: "not_your_turn", seq: 0 };
        }
        return await runtimeBase.applyGameIntent(input);
      },
    };

    const actionIds = new Set<string>();
    const handlers = createWsHandlers({
      runtime,
      publishApplied: () => {},
      isDuplicateAction: (_tableId, actionId) => actionIds.has(actionId),
      rememberAction: (_tableId, actionId) => actionIds.add(actionId),
      forgetAction: (_tableId, actionId) => actionIds.delete(actionId),
      publishToTable: (_tableId, message) => {
        published.push(message);
      },
    });

    await handlers.onMessage(
      {
        send(message) {
          sent.push(message);
        },
        userId: "user-b",
      },
      {
        actionId: "action-retry",
        intentType: "roll",
        payload: {} satisfies Json,
        tableId: "table-1",
        type: "intent",
        v: 2,
      },
    );

    // after illegal_action the reservation should be cleared; retry should call apply again
    await handlers.onMessage(
      {
        send() {},
        userId: "user-b",
      },
      {
        actionId: "action-retry",
        intentType: "roll",
        payload: {} satisfies Json,
        tableId: "table-1",
        type: "intent",
        v: 2,
      },
    );

    expect(calls).toBe(2);
  });
});

describe("ws handlers action reservations", () => {
  it("clears the reservation on any failure, not just illegal_action", async () => {
    const runtimeBase = makeRuntime();
    let calls = 0;
    const runtime: WsRuntime = {
      ...runtimeBase,
      async applyGameIntent(input) {
        calls++;
        return await runtimeBase.applyGameIntent(input);
      },
    };

    const actionIds = new Set<string>();
    const handlers = createWsHandlers({
      runtime,
      publishApplied: () => {},
      isDuplicateAction: (_tableId, actionId) => actionIds.has(actionId),
      rememberAction: (_tableId, actionId) => actionIds.add(actionId),
      forgetAction: (_tableId, actionId) => actionIds.delete(actionId),
      publishToTable: () => {},
    });

    const message = {
      actionId: "action-missing-table",
      intentType: "roll",
      payload: {} satisfies Json,
      tableId: "table-other",
      type: "intent",
      v: 2,
    } satisfies ClientTableMessage;

    await handlers.onMessage({ send() {}, userId: "user-a" }, message);
    // A transient failure must not wedge the action for ACTION_TTL_MS: the retry applies.
    await handlers.onMessage({ send() {}, userId: "user-a" }, message);

    expect(calls).toBe(2);
    expect(actionIds.size).toBe(0);
  });
});
