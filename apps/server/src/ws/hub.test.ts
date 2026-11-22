import type { IncomingMessage } from "node:http";
import type { ChatWire, RawGameState, TableMeta } from "@roundhouse/game-core";
import { duelModule } from "@roundhouse/game-duel";
import { yatzyModule } from "@roundhouse/game-yatzy";
import { describe, expect, it, vi } from "vitest";

import { viewerForUser } from "../room/projection";
import type { TableSnapshot, TablesRuntime } from "../room/runtime";

vi.mock("../db/client", () => ({ db: {} }));
vi.mock("./persistence", async () => {
  const actual = await vi.importActual<typeof import("./persistence")>("./persistence");
  return {
    ...actual,
    listChatMessagesForTable: vi.fn().mockResolvedValue([]),
  };
});

import { createWsHub } from "./hub";
import { listChatMessagesForTable, persistChatMessageToDb } from "./persistence";
import { createLimiter } from "./rate-limit";

function makeRuntime(overrides: Partial<TablesRuntime> = {}): TablesRuntime {
  return {
    applyGameIntent: vi.fn(),
    createTable: vi.fn(),
    getMine: vi.fn(),
    getTableLiveState: vi.fn(),
    getTableSnapshot: vi.fn(),
    getTableReplay: vi.fn(),
    getTableSync: vi.fn(),
    joinTable: vi.fn(),
    rematchTable: vi.fn(),
    leaveTable: vi.fn(),
    kickTablePlayer: vi.fn(),
    startTable: vi.fn(),
    ...overrides,
  };
}

function lobbySnapshot(seatUserIds: string[]): TableSnapshot {
  return {
    tableId: "table-1",
    seq: 1,
    state: null,
    meta: {
      code: "ABCD23",
      config: { ruleset: "yatzy" },
      gameId: "yatzy",
      hostUserId: seatUserIds[0],
      seatUserIds,
      softSeatCap: 4,
      spectatorsAllowed: false,
      status: "lobby",
    },
  };
}

function chatWire(id: string, text: string): ChatWire {
  return {
    createdAt: "2026-08-02T08:00:00.000Z",
    id,
    snapshot: { tableId: "table-1" },
    text,
    userId: "user-a",
  };
}

class MockSocket {
  readyState = 1;
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private handlers: Record<string, ((...args: unknown[]) => unknown) | undefined> = {};

  on(event: string, handler: (...args: unknown[]) => unknown) {
    this.handlers[event] = handler;
    return this;
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  async emitMessage(payload: unknown) {
    await this.emitRaw(JSON.stringify(payload));
  }

  async emitRaw(raw: string) {
    await this.handlers.message?.(Buffer.from(raw));
  }

  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }

  /** Fire the transport's `close` event, so the hub forgets the socket. */
  async emitClose(code = 1000, reason = "") {
    await this.handlers.close?.(code, Buffer.from(reason));
    // `unsubscribe` is fire-and-forget, so let its presence broadcast settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  frames() {
    return this.sent.map((message) => JSON.parse(message));
  }
}

describe("hub persistence helpers", () => {
  it("persistChatMessageToDb inserts chat message and returns id", async () => {
    let captured: any = null;
    const mockDb: any = {
      insert: (_table: any) => ({
        values: async (v: any) => {
          captured = v;
        },
      }),
    };

    const now = new Date();
    const res = await persistChatMessageToDb(mockDb, {
      tableId: "t1",
      userId: "u1",
      text: "hello",
      snapshot: { foo: "bar" },
      createdAt: now,
    });

    expect(typeof res.id).toBe("string");
    expect(res.createdAt).toBe(now.toISOString());
    expect(captured).not.toBeNull();
    expect(captured.tableId).toBe("t1");
    expect(captured.userId).toBe("u1");
    expect(captured.text).toBe("hello");
  });
});

describe("ws hub access control", () => {
  it("rejects subscribe for unseated users", async () => {
    const snapshot: TableSnapshot = {
      tableId: "table-1",
      seq: 0,
      state: null,
      meta: {
        code: "ABCD23",
        config: { ruleset: "yatzy" },
        gameId: "yatzy",
        hostUserId: "user-a",
        seatUserIds: ["user-a", "user-b"],
        softSeatCap: 4,
        spectatorsAllowed: false,
        status: "lobby",
      },
    };
    const hub = createWsHub({
      runtime: makeRuntime({
        getTableSnapshot: vi.fn().mockResolvedValue(snapshot),
      }),
      getSessionFromHeaders: async () => ({ user: { id: "user-c" } }),
    });
    const socket = new MockSocket();

    await hub.handleConnection(socket as any, { headers: {} } as IncomingMessage);
    await socket.emitMessage({
      v: 2,
      type: "subscribe",
      tableId: "table-1",
    });

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      expect.objectContaining({
        v: 2,
        type: "error",
        code: "not_seated",
        message: "not_seated",
        tableId: "table-1",
      }),
    ]);
  });

  it("buffers subscribe that arrives while session auth is pending", async () => {
    const snapshot: TableSnapshot = {
      tableId: "table-1",
      seq: 2,
      state: { dice: [1, 2, 3, 4, 5] },
      meta: {
        code: "ABCD23",
        config: { ruleset: "yatzy" },
        gameId: "yatzy",
        hostUserId: "user-a",
        seatUserIds: ["user-a", "user-b"],
        softSeatCap: 4,
        spectatorsAllowed: false,
        status: "active",
      },
    };

    let resolveSession!: (value: { user: { id: string } }) => void;
    const sessionPromise = new Promise<{ user: { id: string } }>((resolve) => {
      resolveSession = resolve;
    });

    const hub = createWsHub({
      runtime: makeRuntime({
        getTableSnapshot: vi.fn().mockResolvedValue(snapshot),
      }),
      getSessionFromHeaders: () => sessionPromise,
    });
    const socket = new MockSocket();

    const connected = hub.handleConnection(socket as any, { headers: {} } as IncomingMessage);
    await socket.emitMessage({
      v: 2,
      type: "subscribe",
      tableId: "table-1",
    });
    expect(socket.sent).toEqual([]);

    resolveSession({ user: { id: "user-a" } });
    await connected;

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          v: 2,
          type: "snapshot",
          tableId: "table-1",
          seq: 2,
        }),
      ]),
    );
  });

  it("never replays chat history as a side effect of subscribing", async () => {
    const hub = createWsHub({
      runtime: makeRuntime({
        getTableSnapshot: vi.fn().mockResolvedValue(lobbySnapshot(["user-a"])),
      }),
      getSessionFromHeaders: async () => ({ user: { id: "user-a" } }),
    });
    const socket = new MockSocket();

    await hub.handleConnection(socket as any, { headers: {} } as IncomingMessage);
    await socket.emitMessage({ v: 2, type: "subscribe", tableId: "table-1" });

    const frames = socket.sent.map((message) => JSON.parse(message));
    expect(frames.map((frame) => frame.type)).toEqual(["snapshot", "presence"]);
    expect(listChatMessagesForTable).not.toHaveBeenCalled();
  });

  it("serves the newest chat page on request", async () => {
    const hub = createWsHub({
      runtime: makeRuntime({
        getTableSnapshot: vi.fn().mockResolvedValue(lobbySnapshot(["user-a"])),
      }),
      getSessionFromHeaders: async () => ({ user: { id: "user-a" } }),
      listChatPage: vi.fn().mockResolvedValue({
        hasMore: true,
        messages: [chatWire("chat-1", "hello again")],
      }),
    });
    const socket = new MockSocket();

    await hub.handleConnection(socket as any, { headers: {} } as IncomingMessage);
    await socket.emitMessage({ v: 2, type: "subscribe", tableId: "table-1" });
    await socket.emitMessage({ v: 2, type: "chatPage", tableId: "table-1" });

    const frame = socket.frames().find((candidate) => candidate.type === "chatPage");

    expect(frame).toEqual({
      hasMore: true,
      messages: [chatWire("chat-1", "hello again")],
      tableId: "table-1",
      type: "chatPage",
      v: 2,
    });
  });

  it("asks for older chat with a cursor", async () => {
    const listChatPage = vi
      .fn()
      .mockResolvedValue({ hasMore: false, messages: [chatWire("chat-0", "older")] });
    const hub = createWsHub({
      runtime: makeRuntime({
        getTableSnapshot: vi.fn().mockResolvedValue(lobbySnapshot(["user-a"])),
      }),
      getSessionFromHeaders: async () => ({ user: { id: "user-a" } }),
      listChatPage,
    });
    const socket = new MockSocket();

    await hub.handleConnection(socket as any, { headers: {} } as IncomingMessage);
    await socket.emitMessage({ v: 2, type: "subscribe", tableId: "table-1" });
    await socket.emitMessage({ v: 2, type: "chatPage", tableId: "table-1", beforeId: "chat-1" });

    expect(listChatPage).toHaveBeenLastCalledWith({ beforeId: "chat-1", tableId: "table-1" });
  });

  it("refuses a chat page for a table the socket never subscribed to", async () => {
    const listChatPage = vi.fn();
    const hub = createWsHub({
      runtime: makeRuntime({
        getTableSnapshot: vi.fn().mockResolvedValue(lobbySnapshot(["user-a"])),
      }),
      getSessionFromHeaders: async () => ({ user: { id: "user-a" } }),
      listChatPage,
    });
    const socket = new MockSocket();

    await hub.handleConnection(socket as any, { headers: {} } as IncomingMessage);
    await socket.emitMessage({ v: 2, type: "chatPage", tableId: "table-1" });

    expect(listChatPage).not.toHaveBeenCalled();
    expect(socket.frames()).toEqual([
      expect.objectContaining({ code: "not_subscribed", type: "error" }),
    ]);
  });
});

describe("ws hub snapshot projection", () => {
  it("carries authoritative state to every viewer on an applied intent", async () => {
    const meta: TableMeta = {
      code: "ABCD23",
      config: { ruleset: "yatzy" },
      gameId: "yatzy",
      hostUserId: "user-a",
      seatUserIds: ["user-a", "user-b"],
      softSeatCap: 4,
      spectatorsAllowed: false,
      status: "active",
    };
    const finishedState = yatzyModule.createInitialState({ ruleset: "yatzy" }, [
      "user-a",
      "user-b",
    ]);

    let nextUserId = "user-a";
    const hub = createWsHub({
      runtime: makeRuntime({
        applyGameIntent: vi.fn().mockResolvedValue({
          events: [],
          finished: true,
          meta,
          ok: true,
          seq: 5,
          state: finishedState as unknown as RawGameState,
        }),
        getTableSnapshot: vi
          .fn()
          .mockResolvedValue({ meta, seq: 0, state: null, tableId: "table-1" }),
      }),
      getSessionFromHeaders: async () => ({ user: { id: nextUserId } }),
    });

    const socketA = new MockSocket();
    await hub.handleConnection(socketA as any, { headers: {} } as IncomingMessage);
    await socketA.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });

    nextUserId = "user-b";
    const socketB = new MockSocket();
    await hub.handleConnection(socketB as any, { headers: {} } as IncomingMessage);
    await socketB.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });

    socketA.sent.length = 0;
    socketB.sent.length = 0;

    await socketA.emitMessage({
      actionId: "action-1",
      intentType: "roll",
      payload: {},
      tableId: "table-1",
      type: "intent",
      v: 2,
    });

    const snapshotFor = (socket: MockSocket) =>
      socket.sent
        .map((message) => JSON.parse(message))
        .find((message) => message.type === "applied");

    const frameA = snapshotFor(socketA);
    const frameB = snapshotFor(socketB);

    expect(frameA.state.you).toBe(0);
    expect(frameB.state.you).toBe(1);
    // Two players see the same board; only "you" distinguishes the projections.
    const { you: _youA, ...boardA } = frameA.state;
    const { you: _youB, ...boardB } = frameB.state;
    expect(boardA).toEqual(boardB);
    // The internal shape must not cross the wire: only YatzyView fields do.
    expect(frameA.state.tableId).toBeUndefined();
    expect(frameA.state.currentPlayerIndex).toBeUndefined();
  });
});

describe("ws hub message boundary", () => {
  const meta: TableMeta = {
    code: "ABCD23",
    config: { ruleset: "yatzy" },
    gameId: "yatzy",
    hostUserId: "user-a",
    seatUserIds: ["user-a", "user-b"],
    softSeatCap: 4,
    spectatorsAllowed: false,
    status: "active",
  };

  function makeHub(userId: string | null = "user-a") {
    return createWsHub({
      runtime: makeRuntime({
        getTableSnapshot: vi
          .fn()
          .mockResolvedValue({ meta, seq: 0, state: null, tableId: "table-1" }),
      }),
      getSessionFromHeaders: async () => (userId ? { user: { id: userId } } : null),
    });
  }

  async function connect(hub: ReturnType<typeof createWsHub>) {
    const socket = new MockSocket();
    await hub.handleConnection(socket as any, { headers: {} } as IncomingMessage);
    return socket;
  }

  it("reports malformed JSON and keeps the socket open", async () => {
    const socket = await connect(makeHub());

    await socket.emitRaw("{not json");

    expect(socket.frames()).toEqual([
      expect.objectContaining({ code: "bad_message", type: "error", v: 2 }),
    ]);
    expect(socket.closed).toBeNull();

    // The connection still works afterwards: a bad frame must not wedge the stream.
    await socket.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });
    expect(socket.frames().some((frame) => frame.type === "snapshot")).toBe(true);
  });

  it("reports an unknown message type without closing", async () => {
    const socket = await connect(makeHub());

    await socket.emitRaw(JSON.stringify({ type: "teleport", v: 2 }));

    expect(socket.frames()).toEqual([
      expect.objectContaining({ code: "unknown_message_type", type: "error" }),
    ]);
    expect(socket.closed).toBeNull();
  });

  it("reports a frame that fails the schema with the field that failed", async () => {
    const socket = await connect(makeHub());

    await socket.emitRaw(
      JSON.stringify({ tableId: "table-1", type: "subscribe", v: 2, extra: true }),
    );

    // Unknown keys are stripped rather than rejected, so this one still works.
    expect(socket.frames().some((frame) => frame.type === "snapshot")).toBe(true);

    await socket.emitRaw(JSON.stringify({ tableId: "", type: "subscribe", v: 2 }));
    const errors = socket.frames().filter((frame) => frame.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("bad_message");
    expect(errors[0].message).toContain("tableId");
  });

  it("refuses an oversized frame and closes with 1009", async () => {
    const socket = await connect(makeHub());

    await socket.emitRaw(JSON.stringify({ text: "x".repeat(70 * 1024), type: "chat", v: 2 }));

    expect(socket.frames()).toEqual([
      expect.objectContaining({ code: "frame_too_large", type: "error" }),
    ]);
    expect(socket.closed).toEqual({ code: 1009, reason: "frame_too_large" });
  });

  it("explains an unauthenticated connection before closing it", async () => {
    const socket = await connect(makeHub(null));

    expect(socket.frames()).toEqual([
      expect.objectContaining({ code: "not_authenticated", type: "error" }),
    ]);
    expect(socket.closed).toEqual({ code: 4401, reason: "not_authenticated" });
  });
});

describe("ws hub sync v2", () => {
  const meta: TableMeta = {
    code: "ABCD23",
    config: { ruleset: "yatzy" },
    gameId: "yatzy",
    hostUserId: "user-a",
    seatUserIds: ["user-a", "user-b"],
    softSeatCap: 4,
    spectatorsAllowed: false,
    status: "active",
  };
  const activeState = yatzyModule.createInitialState(
    { ruleset: "yatzy" },
    meta.seatUserIds,
  ) as unknown as RawGameState;

  function makeHub(overrides: Partial<TablesRuntime> = {}, userId = "user-a") {
    let seq = 0;
    return createWsHub({
      // Fifty intents in one tick prove frame fan-out, not the budget (#45).
      limits: {
        chat: createLimiter({ limit: 1_000, windowMs: 1_000 }),
        intent: createLimiter({ limit: 1_000, windowMs: 1_000 }),
      },
      runtime: makeRuntime({
        applyGameIntent: vi.fn().mockImplementation(async () => {
          seq += 1;
          return { events: [], finished: false, meta, ok: true, seq, state: activeState };
        }),
        getTableSnapshot: vi
          .fn()
          .mockResolvedValue({ meta, seq: 0, state: activeState, tableId: "table-1" }),
        ...overrides,
      }),
      getSessionFromHeaders: async () => ({ user: { id: userId } }),
    });
  }

  async function subscribe(hub: ReturnType<typeof createWsHub>) {
    const socket = new MockSocket();
    await hub.handleConnection(socket as any, { headers: {} } as IncomingMessage);
    await socket.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });
    socket.sent.length = 0;
    return socket;
  }

  it("answers every intent with one applied frame and no chat re-reads", async () => {
    const hub = makeHub();
    const socket = await subscribe(hub);

    for (let roll = 0; roll < 50; roll += 1) {
      await socket.emitMessage({
        actionId: `action-${roll}`,
        intentType: "roll",
        payload: {},
        tableId: "table-1",
        type: "intent",
        v: 2,
      });
    }

    const frames = socket.frames();
    expect(frames).toHaveLength(50);
    expect(frames.every((frame) => frame.type === "applied")).toBe(true);
    expect(frames.map((frame) => frame.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    // The v1 storm: every event re-subscribed, which re-read 200 chat rows.
    expect(listChatMessagesForTable).not.toHaveBeenCalled();
  });

  it("replays the gap on sync instead of resending the table", async () => {
    const hub = makeHub({
      getTableSync: vi.fn().mockResolvedValue({
        events: [
          {
            actorId: "user-b",
            createdAt: "2026-08-02T00:00:00.000Z",
            gameId: "game-1",
            id: "event-2",
            payload: {},
            seq: 2,
            tableId: "table-1",
            type: "dice_held",
          },
        ],
        fromSeq: 1,
        kind: "events",
        meta,
        state: activeState,
        tableId: "table-1",
        toSeq: 2,
      }),
    });
    const socket = await subscribe(hub);

    await socket.emitMessage({ sinceSeq: 1, tableId: "table-1", type: "sync", v: 2 });

    expect(socket.frames()).toEqual([
      expect.objectContaining({ fromSeq: 1, toSeq: 2, type: "events" }),
    ]);
  });

  it("falls back to a snapshot when the replay is too old", async () => {
    const hub = makeHub({
      getTableSync: vi.fn().mockResolvedValue({
        kind: "snapshot",
        meta,
        seq: 900,
        state: activeState,
        tableId: "table-1",
      }),
    });
    const socket = await subscribe(hub);

    await socket.emitMessage({ sinceSeq: 1, tableId: "table-1", type: "sync", v: 2 });

    expect(socket.frames()).toEqual([expect.objectContaining({ seq: 900, type: "snapshot" })]);
  });

  it("does not rebroadcast presence for a second socket of an online user", async () => {
    const hub = makeHub();
    const first = await subscribe(hub);
    // Same user, second tab: the roster did not change for anyone else.
    const secondSocket = new MockSocket();
    await hub.handleConnection(secondSocket as any, { headers: {} } as IncomingMessage);
    await secondSocket.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });

    expect(first.frames().filter((frame) => frame.type === "presence")).toEqual([]);
    expect(secondSocket.frames()).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "presence" })]),
    );
  });
});

describe("hub shutdown", () => {
  const meta: TableMeta = {
    code: "ABCD23",
    config: { ruleset: "yatzy" },
    gameId: "yatzy",
    hostUserId: "user-a",
    seatUserIds: ["user-a", "user-b"],
    softSeatCap: 4,
    spectatorsAllowed: false,
    status: "active",
  };

  function makeHub() {
    return createWsHub({
      runtime: makeRuntime({
        getTableSnapshot: vi
          .fn()
          .mockImplementation(async () => ({ meta, seq: 0, state: null, tableId: "table-1" })),
      }),
      getSessionFromHeaders: async () => ({ user: { id: "user-a" } }),
    });
  }

  async function connect(hub: ReturnType<typeof createWsHub>) {
    const socket = new MockSocket();
    await hub.handleConnection(socket as any, { headers: {} } as IncomingMessage);
    await socket.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });
    return socket;
  }

  it("closes every live socket with a retryable code and a reason", async () => {
    const hub = makeHub();
    const first = await connect(hub);
    const second = await connect(hub);

    const closed = hub.shutdown();

    expect(closed).toBe(2);
    expect(first.closed).toEqual({ code: 1012, reason: "server_restart" });
    expect(second.closed).toEqual({ code: 1012, reason: "server_restart" });
  });

  it("forgets the rooms, so a later publish reaches nobody", async () => {
    const hub = makeHub();
    const socket = await connect(hub);

    hub.shutdown();
    await hub.publishTableState("table-1");

    expect(socket.frames().filter((frame) => frame.type === "snapshot")).toHaveLength(1);
  });
});
describe("hub seat eviction", () => {
  async function twoSeatsInOneRoom() {
    let nextUserId = "user-a";
    const hub = createWsHub({
      runtime: makeRuntime({
        getTableSnapshot: vi.fn().mockResolvedValue(lobbySnapshot(["user-a", "user-b"])),
      }),
      getSessionFromHeaders: async () => ({ user: { id: nextUserId } }),
    });

    const host = new MockSocket();
    await hub.handleConnection(host as any, { headers: {} } as IncomingMessage);
    await host.emitMessage({ v: 2, type: "subscribe", tableId: "table-1" });

    nextUserId = "user-b";
    const guest = new MockSocket();
    await hub.handleConnection(guest as any, { headers: {} } as IncomingMessage);
    await guest.emitMessage({ v: 2, type: "subscribe", tableId: "table-1" });

    host.sent.length = 0;
    guest.sent.length = 0;
    return { guest, host, hub };
  }

  it("tells the kicked player why, drops their socket and updates presence", async () => {
    const { guest, host, hub } = await twoSeatsInOneRoom();

    await hub.evictFromTable("table-1", "user-b", "kicked");

    expect(guest.frames()).toEqual([
      expect.objectContaining({ code: "kicked", type: "error", tableId: "table-1" }),
    ]);
    expect(guest.closed).toEqual({ code: 4403, reason: "kicked" });
    // The room is told who is left, so the kicked player's dot disappears.
    expect(host.frames()).toEqual([
      expect.objectContaining({ onlineUserIds: ["user-a"], type: "presence" }),
    ]);
  });

  it("tells a player who gave up their seat that the seat is gone", async () => {
    const { guest, hub } = await twoSeatsInOneRoom();

    await hub.evictFromTable("table-1", "user-b", "left");

    expect(guest.frames()).toEqual([expect.objectContaining({ code: "seat_left", type: "error" })]);
    expect(guest.closed).toEqual({ code: 4403, reason: "seat_left" });
  });

  it("leaves the room alone when the evicted user has no socket there", async () => {
    const { host, hub } = await twoSeatsInOneRoom();

    await hub.evictFromTable("table-1", "user-z", "kicked");

    expect(host.frames()).toEqual([]);
  });

  it("stops evicted sockets from receiving later state pushes", async () => {
    const { guest, hub } = await twoSeatsInOneRoom();

    await hub.evictFromTable("table-1", "user-b", "kicked");
    guest.sent.length = 0;
    await hub.publishTableState("table-1");

    expect(guest.frames()).toEqual([]);
  });

  it("refuses a later subscribe from the kicked player", async () => {
    let nextUserId = "user-a";
    const getTableSnapshot = vi.fn(async () => lobbySnapshot(["user-a"]));
    const hub = createWsHub({
      runtime: makeRuntime({ getTableSnapshot }),
      getSessionFromHeaders: async () => ({ user: { id: nextUserId } }),
    });

    const host = new MockSocket();
    await hub.handleConnection(host as any, { headers: {} } as IncomingMessage);
    await host.emitMessage({ v: 2, type: "subscribe", tableId: "table-1" });
    await hub.evictFromTable("table-1", "user-b", "kicked");

    // The kicked player reconnects to a page they still have open: the seat is
    // gone, so the subscribe is refused rather than silently joined.
    nextUserId = "user-b";
    const reconnect = new MockSocket();
    await hub.handleConnection(reconnect as any, { headers: {} } as IncomingMessage);
    await reconnect.emitMessage({ v: 2, type: "subscribe", tableId: "table-1" });

    expect(reconnect.frames()).toEqual([
      expect.objectContaining({ code: "not_seated", type: "error" }),
    ]);
    // A refused subscribe answers, it does not hang up: the page keeps its socket.
    expect(reconnect.closed).toBeNull();
  });
});

describe("ws hub spectators (M2-1, #56)", () => {
  const meta = (overrides: Partial<TableMeta> = {}): TableMeta => ({
    code: "ABCD23",
    config: { ruleset: "yatzy" },
    gameId: "yatzy",
    hostUserId: "user-a",
    seatUserIds: ["user-a", "user-b"],
    softSeatCap: 4,
    spectatorsAllowed: true,
    status: "active",
    ...overrides,
  });

  const liveState = () =>
    yatzyModule.createInitialState({ ruleset: "yatzy" }, ["user-a", "user-b"]);

  function seatedRuntime(tableMeta: TableMeta, state: RawGameState = liveState() as RawGameState) {
    return makeRuntime({
      // The runtime projects the subscribe snapshot itself (ADR 0001), so a
      // spectator's snapshot arrives already projected for nobody.
      getTableSnapshot: vi.fn().mockImplementation(async ({ asUserId }) => ({
        meta: tableMeta,
        seq: 1,
        state:
          state === null
            ? null
            : yatzyModule.projectStateFor(state, viewerForUser(tableMeta.seatUserIds, asUserId)),
        tableId: "table-1",
      })),
      getTableLiveState: vi.fn().mockResolvedValue({
        meta: tableMeta,
        seq: 1,
        state,
        tableId: "table-1",
      }),
    });
  }

  /** One hub whose session identity is chosen per connection, in call order. */
  function hubFor(runtime: TablesRuntime, userIds: string[]) {
    const queue = [...userIds];
    return createWsHub({
      runtime,
      getSessionFromHeaders: async () => ({ user: { id: queue.shift() ?? "user-anon" } }),
    });
  }

  it("admits someone without a seat to a public table, projected for a spectator", async () => {
    const runtime = seatedRuntime(meta());
    const hub = hubFor(runtime, ["user-c"]);
    const socket = new MockSocket();

    await hub.handleConnection(socket as any, { headers: {} } as IncomingMessage);
    await socket.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });

    const frames = socket.frames();
    expect(frames.map((frame) => frame.type)).toEqual(["snapshot", "presence"]);
    // The spectator projection: the board, with no seat of their own.
    expect(frames[0].state).toMatchObject({ phase: "playing", you: null });
    expect(frames[0].state.currentPlayerIndex).toBeUndefined();
    // Watching is not playing: a seat list and a watcher list, kept apart.
    expect(frames[1]).toMatchObject({ onlineUserIds: [], spectatorUserIds: ["user-c"] });
  });

  it("refuses a non-seat on a private table and on a table that does not exist", async () => {
    const privateHub = hubFor(seatedRuntime(meta({ spectatorsAllowed: false })), ["user-c"]);
    const privateSocket = new MockSocket();
    await privateHub.handleConnection(privateSocket as any, { headers: {} } as IncomingMessage);
    await privateSocket.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });
    expect(privateSocket.frames()).toEqual([
      expect.objectContaining({ code: "not_seated", type: "error" }),
    ]);

    const missingHub = hubFor(makeRuntime({ getTableSnapshot: vi.fn().mockResolvedValue(null) }), [
      "user-c",
    ]);
    const missingSocket = new MockSocket();
    await missingHub.handleConnection(missingSocket as any, { headers: {} } as IncomingMessage);
    await missingSocket.emitMessage({ tableId: "no-such-table", type: "subscribe", v: 2 });
    expect(missingSocket.frames()).toEqual([
      expect.objectContaining({ code: "table_missing", type: "error" }),
    ]);
  });

  it("sends a watcher the same applied frame the players get, projected for a spectator", async () => {
    const tableMeta = meta();
    const state = liveState();
    const rolled = yatzyModule.reduce(
      state,
      { payload: {}, type: "roll" },
      {
        actorId: "user-a",
        now: () => new Date(),
        playerIds: ["user-a", "user-b"],
        randomInt: () => 0,
      },
    );
    if (!rolled.ok) throw new Error(rolled.error);

    const runtime = seatedRuntime(tableMeta, rolled.state as unknown as RawGameState);
    runtime.applyGameIntent = vi.fn().mockResolvedValue({
      events: [],
      finished: false,
      meta: tableMeta,
      ok: true,
      seq: 2,
      state: rolled.state as unknown as RawGameState,
    });
    const hub = hubFor(runtime, ["user-a", "user-c"]);
    const player = new MockSocket();
    const watcher = new MockSocket();

    await hub.handleConnection(player as any, { headers: {} } as IncomingMessage);
    await player.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });
    await hub.handleConnection(watcher as any, { headers: {} } as IncomingMessage);
    await watcher.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });
    // Presence follows membership, so the watcher's own join is the frame that
    // names it — read it before the intent clears the buffer.
    const presenceOnJoin = watcher
      .frames()
      .filter((frame) => frame.type === "presence")
      .at(-1);
    player.sent.length = 0;
    watcher.sent.length = 0;

    await player.emitMessage({
      actionId: "action-1",
      intentType: "roll",
      payload: {},
      tableId: "table-1",
      type: "intent",
      v: 2,
    });

    const applied = (socket: MockSocket) =>
      socket.frames().find((frame) => frame.type === "applied");
    const playerFrame = applied(player);
    const watcherFrame = applied(watcher);

    expect(watcherFrame.state.you).toBeNull();
    expect({ ...playerFrame.state, you: null }).toEqual(watcherFrame.state);
    // Presence says who is playing and who is only watching.
    expect(presenceOnJoin).toMatchObject({
      onlineUserIds: ["user-a"],
      spectatorUserIds: ["user-c"],
    });
  });

  it("never shows a hidden pick to a spectator before the reveal", async () => {
    const tableMeta = meta({ config: { rounds: 3 }, gameId: "duel" });
    const initial = duelModule.createInitialState({ rounds: 3 }, ["user-a", "user-b"]);
    const picked = duelModule.reduce(
      initial,
      { payload: { card: "strike" }, type: "play" },
      {
        actorId: "user-a",
        now: () => new Date(),
        playerIds: ["user-a", "user-b"],
        randomInt: () => 0,
      },
    );
    if (!picked.ok) throw new Error(picked.error);

    const runtime = seatedRuntime(tableMeta, picked.state as unknown as RawGameState);
    runtime.applyGameIntent = vi.fn().mockResolvedValue({
      events: [],
      finished: false,
      meta: tableMeta,
      ok: true,
      seq: 2,
      state: picked.state as unknown as RawGameState,
    });
    const hub = hubFor(runtime, ["user-a", "user-c"]);
    const player = new MockSocket();
    const watcher = new MockSocket();
    await hub.handleConnection(player as any, { headers: {} } as IncomingMessage);
    await player.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });
    await hub.handleConnection(watcher as any, { headers: {} } as IncomingMessage);
    await watcher.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });
    watcher.sent.length = 0;

    await player.emitMessage({
      actionId: "action-1",
      intentType: "play",
      payload: { card: "strike" },
      tableId: "table-1",
      type: "intent",
      v: 2,
    });

    // Asserted on the serialised frame, not on a field name: a card that is not
    // in the bytes cannot be read off the wire.
    const serialised = JSON.stringify(watcher.frames());
    expect(serialised).not.toContain("strike");
    expect(serialised).not.toContain("pending");
  });

  it("stops listing a watcher as a spectator when their socket closes", async () => {
    const runtime = seatedRuntime(meta());
    const hub = hubFor(runtime, ["user-a", "user-c"]);
    const player = new MockSocket();
    const watcher = new MockSocket();
    await hub.handleConnection(player as any, { headers: {} } as IncomingMessage);
    await player.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });
    await hub.handleConnection(watcher as any, { headers: {} } as IncomingMessage);
    await watcher.emitMessage({ tableId: "table-1", type: "subscribe", v: 2 });
    player.sent.length = 0;

    await watcher.emitClose();

    expect(
      player
        .frames()
        .filter((frame) => frame.type === "presence")
        .at(-1),
    ).toMatchObject({
      onlineUserIds: ["user-a"],
      spectatorUserIds: [],
    });
  });
});
