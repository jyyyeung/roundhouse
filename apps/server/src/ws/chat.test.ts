import type { ClientTableMessage, ServerMessage } from "@roundhouse/game-core";
import { yatzyModule } from "@roundhouse/game-yatzy";
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

  const seq = 0;
  const state = yatzyModule.createInitialState(meta.config, playerIds);

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
      publishApplied: () => {},
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
    });

    await handlers.onMessage(
      {
        send() {},
        userId: "user-a",
      },
      {
        actionId: "action-chat",
        tableId: "table-1",
        text: "hello",
        type: "chat",
        v: 2,
      } satisfies ClientTableMessage,
    );

    expect(persisted).not.toBeNull();
    // persisted.snapshot.state should equal server state (not client-supplied fake)
    const serverSnapshot = await runtime.getTableSnapshot({ asUserId: null, tableId: "table-1" });
    expect(persisted.snapshot.state).toEqual(serverSnapshot?.state);
    // published a chat ServerMessage
    const chat = published.find((m) => m.type === "chat");
    expect(chat).toEqual(
      expect.objectContaining({
        type: "chat",
        tableId: "table-1",
        message: expect.objectContaining({
          id: "msg-1",
          userId: "user-a",
          text: "hello",
        }),
      }),
    );
  });

  it("rejects chat from unseated users", async () => {
    const published: ServerMessage[] = [];
    const sent: ServerMessage[] = [];
    const persistChatMessage = vi.fn();
    const handlers = createWsHandlers({
      runtime: makeRuntime(),
      publishApplied: () => {},
      isDuplicateAction: () => false,
      rememberAction: () => {},
      forgetAction: () => {},
      publishToTable: (_tableId, message) => {
        published.push(message);
      },
      persistChatMessage,
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
        tableId: "table-1",
        text: "hello",
        type: "chat",
        v: 2,
      } satisfies ClientTableMessage,
    );

    expect(sent).toEqual([
      expect.objectContaining({
        actionId: "action-chat",
        code: "not_seated",
        message: "not_seated",
        tableId: "table-1",
        type: "error",
        v: 2,
      }),
    ]);
    expect(published).toEqual([]);
    expect(persistChatMessage).not.toHaveBeenCalled();
  });

  // M0-3: chat is not a game event. The handlers have no game-event writer to
  // reach, so a chat message can never advance `game.seq` or add a
  // `game_event` row — the only writes it makes are chat rows.
  it("never touches game state when a message is sent", async () => {
    const runtime = makeRuntime();
    const applyGameIntent = vi.spyOn(runtime, "applyGameIntent");
    const handlers = createWsHandlers({
      runtime,
      forgetAction: () => {},
      isDuplicateAction: () => false,
      publishApplied: () => {},
      publishToTable: () => {},
      rememberAction: () => {},
      persistChatMessage: async () => ({ createdAt: new Date().toISOString(), id: "msg-1" }),
    });

    await handlers.onMessage({ send() {}, userId: "user-a" }, {
      actionId: "action-chat",
      tableId: "table-1",
      text: "hello",
      type: "chat",
      v: 2,
    } satisfies ClientTableMessage);

    expect(applyGameIntent).not.toHaveBeenCalled();
    const after = await runtime.getTableSnapshot({ asUserId: null, tableId: "table-1" });
    expect(after?.seq).toBe(0);
  });
});
