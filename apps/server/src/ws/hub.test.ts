import type { IncomingMessage } from "node:http";
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

  close() {}
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
