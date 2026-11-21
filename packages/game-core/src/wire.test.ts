import { describe, expect, it } from "vitest";

import {
  clientMessageSchema,
  parseClientMessage,
  serverMessageSchema,
} from "./wire";

const validIntent = {
  actionId: "action-1",
  intentType: "roll",
  payload: {},
  tableId: "table-1",
  type: "intent",
  v: 1,
};

describe("parseClientMessage", () => {
  it("accepts each client frame variant", () => {
    expect(parseClientMessage(JSON.stringify({ tableId: "table-1", type: "subscribe", v: 1 }))).toEqual({
      message: { tableId: "table-1", type: "subscribe", v: 1 },
      ok: true,
    });
    expect(parseClientMessage(JSON.stringify(validIntent))).toEqual({ message: validIntent, ok: true });
    expect(
      parseClientMessage(
        JSON.stringify({ actionId: "action-2", tableId: "table-1", text: "hi", type: "chat", v: 1 }),
      ),
    ).toEqual({
      message: { actionId: "action-2", tableId: "table-1", text: "hi", type: "chat", v: 1 },
      ok: true,
    });
  });

  it("drops fields the schema does not declare", () => {
    const result = parseClientMessage(
      JSON.stringify({
        // A v1 client used to send the text twice, and an attacker would send a
        // forged snapshot; neither may survive the boundary.
        payload: { text: "hi" },
        snapshot: { state: { fake: "client" } },
        tableId: "table-1",
        text: "hi",
        type: "chat",
        actionId: "action-2",
        v: 1,
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.message).toEqual({
      actionId: "action-2",
      tableId: "table-1",
      text: "hi",
      type: "chat",
      v: 1,
    });
  });

  it("reports invalid JSON instead of throwing", () => {
    expect(parseClientMessage("{not json")).toEqual({
      code: "bad_message",
      detail: "invalid_json",
      ok: false,
    });
  });

  it("distinguishes an unknown type from a malformed frame", () => {
    expect(parseClientMessage(JSON.stringify({ type: "teleport", v: 1 }))).toMatchObject({
      code: "unknown_message_type",
      ok: false,
    });
    // A type that isn't even a string is a malformed frame, not an unknown one.
    expect(parseClientMessage(JSON.stringify({ type: 5, v: 1 }))).toMatchObject({
      code: "bad_message",
      ok: false,
    });
    expect(parseClientMessage(JSON.stringify(null))).toMatchObject({ code: "bad_message", ok: false });
  });

  it("names the field that failed", () => {
    const missingActionId = parseClientMessage(
      JSON.stringify({ ...validIntent, actionId: undefined }),
    );
    expect(missingActionId).toMatchObject({ code: "bad_message", ok: false });
    expect(missingActionId.ok === false && missingActionId.detail).toContain("actionId");

    const emptyTableId = parseClientMessage(JSON.stringify({ tableId: "", type: "subscribe", v: 1 }));
    expect(emptyTableId).toMatchObject({ code: "bad_message", ok: false });
    expect(emptyTableId.ok === false && emptyTableId.detail).toContain("tableId");
  });

  it("rejects identifier and chat text caps", () => {
    expect(
      parseClientMessage(JSON.stringify({ tableId: "t".repeat(65), type: "subscribe", v: 1 })),
    ).toMatchObject({ code: "bad_message", ok: false });
    expect(
      parseClientMessage(
        JSON.stringify({
          actionId: "a",
          tableId: "table-1",
          text: "x".repeat(4001),
          type: "chat",
          v: 1,
        }),
      ),
    ).toMatchObject({ code: "bad_message", ok: false });
  });
});

describe("server frames", () => {
  const meta = {
    code: "ABCD23",
    config: { ruleset: "yatzy" },
    gameId: "yatzy",
    hostUserId: "user-a",
    seatUserIds: ["user-a"],
    softSeatCap: 4,
    status: "lobby",
  };

  it("round-trips every server frame variant", () => {
    const frames = [
      { meta, seq: 0, state: null, tableId: "table-1", type: "snapshot", v: 1 },
      {
        event: {
          actorId: "user-a",
          createdAt: "2026-08-02T00:00:00.000Z",
          gameId: "yatzy",
          id: "event-1",
          payload: {},
          seq: 1,
          tableId: "table-1",
          type: "dice_rolled",
        },
        tableId: "table-1",
        type: "event",
        v: 1,
      },
      {
        message: {
          createdAt: "2026-08-02T00:00:00.000Z",
          id: "chat-1",
          snapshot: {},
          text: "hi",
          userId: "user-a",
        },
        tableId: "table-1",
        type: "chat",
        v: 1,
      },
      { code: "not_seated", message: "not_seated", tableId: "table-1", type: "error", v: 1 },
      { onlineUserIds: ["user-a"], tableId: "table-1", type: "presence", v: 1 },
    ];

    for (const frame of frames) {
      expect(serverMessageSchema.safeParse(frame).success).toBe(true);
    }
  });

  it("rejects a snapshot whose status is not a real table status", () => {
    const frame = { meta: { ...meta, status: "paused" }, seq: 0, state: null, tableId: "table-1", type: "snapshot", v: 1 };
    expect(serverMessageSchema.safeParse(frame).success).toBe(false);
  });
});

describe("clientMessageSchema", () => {
  it("requires protocol version 1", () => {
    expect(clientMessageSchema.safeParse({ tableId: "table-1", type: "subscribe", v: 2 }).success).toBe(
      false,
    );
  });
});
