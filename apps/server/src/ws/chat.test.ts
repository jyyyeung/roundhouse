import type { Json, ServerMessage } from "@yatzy/game-core";
import { yatzyModule } from "@yatzy/game-yatzy";
import { describe, expect, it, vi } from "vitest";

import { createWsHandlers, type WsRuntime } from "./handlers";

function makeRuntime(): WsRuntime {
  const tableId = "table-1";
  const playerIds = ["user-a", "user-b"];
  const meta: any = {
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
    async applyGameIntent() {
      throw new Error("not used");
    },
  };
}

describe("ws chat", () => {
  it("ignores client-supplied dice and stores server snapshot", async () => {
    const published: ServerMessage[] = [];
    const runtime = makeRuntime();
    let persisted: any = null;
    const handlers = createWsHandlers({
      runtime,
      isDuplicateAction: () => false,
      rememberAction: () => {},
      forgetAction: () => {},
      publishToTable: (_tableId, message) => {
        published.push(message);
      },
      persistChatMessage: async ({ tableId, userId, text, snapshot }) => {
        persisted = { tableId, userId, text, snapshot };
        return { id: "msg-1", createdAt: new Date().toISOString() };
      },
      appendGameEvent: async () => ({ id: "ev-1" }),
    });

    await handlers.onMessage(
      {
        send() {},
        userId: "user-a",
      },
      {
        actionId: "action-chat",
        payload: {
          // client tries to supply fake dice in snapshot - should be ignored
          text: "hello",
          snapshot: { state: { fake: "client" } } as Json,
        } as any,
        tableId: "table-1",
        type: "chat",
        v: 1,
      } as any,
    );

    expect(persisted).not.toBeNull();
    // persisted.snapshot.state should equal server state (not client-supplied fake)
    const serverSnapshot = await runtime.getTableSnapshot({ tableId: "table-1" });
    expect(persisted.snapshot.state).toEqual(serverSnapshot?.state);
    // published a chat ServerMessage
    expect(published.some((m) => (m as any).type === "chat")).toBe(true);
  });

  it("rejects chat from unseated users", async () => {
    const published: ServerMessage[] = [];
    const sent: ServerMessage[] = [];
    const persistChatMessage = vi.fn();
    const appendGameEvent = vi.fn();
    const handlers = createWsHandlers({
      runtime: makeRuntime(),
      isDuplicateAction: () => false,
      rememberAction: () => {},
      forgetAction: () => {},
      publishToTable: (_tableId, message) => {
        published.push(message);
      },
      persistChatMessage,
      appendGameEvent,
    });

    await handlers.onMessage(
      {
        send(message) {
          sent.push(message);
        },
        userId: "user-c",
      },
      {
        actionId: "action-chat",
        payload: { text: "hello" },
        tableId: "table-1",
        type: "chat",
        v: 1,
      } as any,
    );

    expect(sent).toEqual([
      expect.objectContaining({
        actionId: "action-chat",
        code: "not_seated",
        message: "not_seated",
        tableId: "table-1",
        type: "error",
        v: 1,
      }),
    ]);
    expect(published).toEqual([]);
    expect(persistChatMessage).not.toHaveBeenCalled();
    expect(appendGameEvent).not.toHaveBeenCalled();
  });
});

