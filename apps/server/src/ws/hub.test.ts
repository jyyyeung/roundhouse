import type { IncomingMessage } from "node:http";
import type { RawGameState, TableMeta } from "@roundhouse/game-core";
import { yatzyModule } from "@roundhouse/game-yatzy";
import { describe, expect, it, vi } from "vitest";

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

function makeRuntime(overrides: Partial<TablesRuntime> = {}): TablesRuntime {
  return {
    applyGameIntent: vi.fn(),
    createTable: vi.fn(),
    getMine: vi.fn(),
    getTableSnapshot: vi.fn(),
    joinTable: vi.fn(),
    rematchTable: vi.fn(),
    startTable: vi.fn(),
    ...overrides,
  };
}

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
    await this.emitRaw(JSON.stringify(payload));
  }

  async emitRaw(raw: string) {
    await this.handlers.message?.(Buffer.from(raw));
  }

  close(code?: number, reason?: string) {
    this.closed = { code, reason };
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
      v: 1,
      type: "subscribe",
      tableId: "table-1",
    });

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      expect.objectContaining({
        v: 1,
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
      v: 1,
      type: "subscribe",
      tableId: "table-1",
    });
    expect(socket.sent).toEqual([]);

    resolveSession({ user: { id: "user-a" } });
    await connected;

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          v: 1,
          type: "snapshot",
          tableId: "table-1",
          seq: 2,
        }),
      ]),
    );
  });

  it("replays persisted chat history on subscribe", async () => {
    const snapshot: TableSnapshot = {
      tableId: "table-1",
      seq: 1,
      state: null,
      meta: {
        code: "ABCD23",
        config: { ruleset: "yatzy" },
        gameId: "yatzy",
        hostUserId: "user-a",
        seatUserIds: ["user-a"],
        softSeatCap: 4,
        status: "lobby",
      },
    };
    vi.mocked(listChatMessagesForTable).mockResolvedValueOnce([
      {
        id: "chat-1",
        userId: "user-a",
        text: "hello again",
        snapshot: { tableId: "table-1" },
        createdAt: new Date("2026-08-02T08:00:00.000Z"),
      },
    ]);

    const hub = createWsHub({
      runtime: makeRuntime({
        getTableSnapshot: vi.fn().mockResolvedValue(snapshot),
      }),
      getSessionFromHeaders: async () => ({ user: { id: "user-a" } }),
    });
    const socket = new MockSocket();

    await hub.handleConnection(socket as any, { headers: {} } as IncomingMessage);
    await socket.emitMessage({
      v: 1,
      type: "subscribe",
      tableId: "table-1",
    });

    expect(listChatMessagesForTable).toHaveBeenCalledWith(expect.anything(), "table-1");
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "snapshot", tableId: "table-1" }),
        expect.objectContaining({
          type: "chat",
          tableId: "table-1",
          message: expect.objectContaining({
            id: "chat-1",
            text: "hello again",
            userId: "user-a",
            createdAt: "2026-08-02T08:00:00.000Z",
          }),
        }),
      ]),
    );
  });
});

describe("ws hub snapshot projection", () => {
  it("projects game state separately for each connected viewer", async () => {
    const meta: TableMeta = {
      code: "ABCD23",
      config: { ruleset: "yatzy" },
      gameId: "yatzy",
      hostUserId: "user-a",
      seatUserIds: ["user-a", "user-b"],
      softSeatCap: 4,
      status: "active",
    };
    const finishedState = yatzyModule.createInitialState({ ruleset: "yatzy" }, ["user-a", "user-b"]);

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
        getTableSnapshot: vi.fn().mockResolvedValue({ meta, seq: 0, state: null, tableId: "table-1" }),
      }),
      getSessionFromHeaders: async () => ({ user: { id: nextUserId } }),
    });

    const socketA = new MockSocket();
    await hub.handleConnection(socketA as any, { headers: {} } as IncomingMessage);
    await socketA.emitMessage({ tableId: "table-1", type: "subscribe", v: 1 });

    nextUserId = "user-b";
    const socketB = new MockSocket();
    await hub.handleConnection(socketB as any, { headers: {} } as IncomingMessage);
    await socketB.emitMessage({ tableId: "table-1", type: "subscribe", v: 1 });

    socketA.sent.length = 0;
    socketB.sent.length = 0;

    await socketA.emitMessage({
      actionId: "action-1",
      intentType: "roll",
      payload: {},
      tableId: "table-1",
      type: "intent",
      v: 1,
    });

    const snapshotFor = (socket: MockSocket) =>
      socket.sent
        .map((message) => JSON.parse(message))
        .find((message) => message.type === "snapshot");

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
    status: "active",
  };

  function makeHub(userId: string | null = "user-a") {
    return createWsHub({
      runtime: makeRuntime({
        getTableSnapshot: vi.fn().mockResolvedValue({ meta, seq: 0, state: null, tableId: "table-1" }),
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
      expect.objectContaining({ code: "bad_message", type: "error", v: 1 }),
    ]);
    expect(socket.closed).toBeNull();

    // The connection still works afterwards: a bad frame must not wedge the stream.
    await socket.emitMessage({ tableId: "table-1", type: "subscribe", v: 1 });
    expect(socket.frames().some((frame) => frame.type === "snapshot")).toBe(true);
  });

  it("reports an unknown message type without closing", async () => {
    const socket = await connect(makeHub());

    await socket.emitRaw(JSON.stringify({ type: "teleport", v: 1 }));

    expect(socket.frames()).toEqual([
      expect.objectContaining({ code: "unknown_message_type", type: "error" }),
    ]);
    expect(socket.closed).toBeNull();
  });

  it("reports a frame that fails the schema with the field that failed", async () => {
    const socket = await connect(makeHub());

    await socket.emitRaw(JSON.stringify({ tableId: "table-1", type: "subscribe", v: 1, extra: true }));

    // Unknown keys are stripped rather than rejected, so this one still works.
    expect(socket.frames().some((frame) => frame.type === "snapshot")).toBe(true);

    await socket.emitRaw(JSON.stringify({ tableId: "", type: "subscribe", v: 1 }));
    const errors = socket.frames().filter((frame) => frame.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("bad_message");
    expect(errors[0].message).toContain("tableId");
  });

  it("refuses an oversized frame and closes with 1009", async () => {
    const socket = await connect(makeHub());

    await socket.emitRaw(JSON.stringify({ text: "x".repeat(70 * 1024), type: "chat", v: 1 }));

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
