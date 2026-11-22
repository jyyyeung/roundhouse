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
import { createLimiter } from "./rate-limit";

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

describe("ws handlers rate limits", () => {
  function fakeClock(start = 1_000) {
    let at = start;
    return {
      advance(ms: number) {
        at += ms;
      },
      now: () => at,
    };
  }

  function intentFrame(actionId: string): ClientTableMessage {
    return {
      actionId,
      intentType: "roll",
      payload: {} satisfies Json,
      tableId: "table-1",
      type: "intent",
      v: 2,
    };
  }

  it("refuses intents past the budget with retryAfterMs and applies none of them", async () => {
    const sent: ServerMessage[] = [];
    const runtimeBase = makeRuntime();
    let calls = 0;
    const runtime: WsRuntime = {
      ...runtimeBase,
      async applyGameIntent(input) {
        calls++;
        return await runtimeBase.applyGameIntent(input);
      },
    };

    const clock = fakeClock();
    const intent = createLimiter({ limit: 2, now: clock.now, windowMs: 1_000 });
    const actionIds = new Set<string>();
    const handlers = createWsHandlers({
      isDuplicateAction: (_tableId, actionId) => actionIds.has(actionId),
      limits: { intent },
      publishApplied: () => {},
      publishToTable: () => {},
      rememberAction: (_tableId, actionId) => actionIds.add(actionId),
      forgetAction: (_tableId, actionId) => actionIds.delete(actionId),
      runtime,
    });

    for (const actionId of ["a-1", "a-2", "a-3"]) {
      await handlers.onMessage(
        { send: (m) => sent.push(m), userId: "user-a" },
        intentFrame(actionId),
      );
    }

    expect(calls).toBe(2);
    expect(sent.at(-1)).toEqual({
      actionId: "a-3",
      code: "rate_limited",
      message: "rate_limited",
      retryAfterMs: 1_000,
      tableId: "table-1",
      type: "error",
      v: 2,
    });
    // The refused attempt must not burn its actionId: a retry after the window is
    // the client's recovery path, and it has to be allowed to apply.
    expect(actionIds.has("a-3")).toBe(false);
  });

  it("applies a retry of a refused action exactly once, after the window", async () => {
    const sent: ServerMessage[] = [];
    const runtimeBase = makeRuntime();
    let calls = 0;
    const runtime: WsRuntime = {
      ...runtimeBase,
      async applyGameIntent(input) {
        calls++;
        return await runtimeBase.applyGameIntent(input);
      },
    };

    const clock = fakeClock();
    const intent = createLimiter({ limit: 1, now: clock.now, windowMs: 1_000 });
    const actionIds = new Set<string>();
    const handlers = createWsHandlers({
      isDuplicateAction: (_tableId, actionId) => actionIds.has(actionId),
      limits: { intent },
      publishApplied: () => {},
      publishToTable: () => {},
      rememberAction: (_tableId, actionId) => actionIds.add(actionId),
      forgetAction: (_tableId, actionId) => actionIds.delete(actionId),
      runtime,
    });

    await handlers.onMessage({ send: (m) => sent.push(m), userId: "user-a" }, intentFrame("first"));
    await handlers.onMessage(
      { send: (m) => sent.push(m), userId: "user-a" },
      intentFrame("retry-me"),
    );
    expect(calls).toBe(1);
    expect(sent.at(-1)).toMatchObject({ actionId: "retry-me", code: "rate_limited" });
    expect(actionIds.has("retry-me")).toBe(false);

    clock.advance(1_000);
    await handlers.onMessage(
      { send: (m) => sent.push(m), userId: "user-a" },
      intentFrame("retry-me"),
    );
    expect(calls).toBe(2);

    // Now that it applied, the id is reserved and a repeat is a duplicate, not a third apply.
    await handlers.onMessage(
      { send: (m) => sent.push(m), userId: "user-a" },
      intentFrame("retry-me"),
    );
    expect(calls).toBe(2);
  });

  it("keeps the chat budget and the intent budget independent", async () => {
    const sent: ServerMessage[] = [];
    const published: ServerMessage[] = [];
    const clock = fakeClock();
    const handlers = createWsHandlers({
      isDuplicateAction: () => false,
      limits: {
        chat: createLimiter({ limit: 1, now: clock.now, windowMs: 1_000 }),
        intent: createLimiter({ limit: 1, now: clock.now, windowMs: 1_000 }),
      },
      persistChatMessage: async () => ({ createdAt: "2026-08-02T00:00:00.000Z", id: "chat-1" }),
      publishApplied: () => {},
      publishToTable: (_tableId, message) => {
        published.push(message);
      },
      rememberAction: () => {},
      forgetAction: () => {},
      runtime: makeRuntime(),
    });
    const connection = { send: (m: ServerMessage) => sent.push(m), userId: "user-a" };

    await handlers.onMessage(connection, intentFrame("a-1"));
    // An intent just spent the intent budget; chat has its own.
    await handlers.onMessage(connection, {
      actionId: "c-1",
      tableId: "table-1",
      text: "hello",
      type: "chat",
      v: 2,
    });
    await handlers.onMessage(connection, {
      actionId: "c-2",
      tableId: "table-1",
      text: "again",
      type: "chat",
      v: 2,
    });

    expect(published.map((message) => message.type)).toEqual(["chat"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ code: "rate_limited", retryAfterMs: 1_000 });
  });
});
