import { describe, expect, it } from "vitest";

import * as persistence from "./persistence";
import { listChatMessagesForTable, persistChatMessageToDb, toChatWire } from "./persistence";

describe("chat paging", () => {
  function row(id: string) {
    return {
      createdAt: new Date("2026-08-02T08:00:00.000Z"),
      id,
      snapshot: { tableId: "table-1" },
      text: `text-${id}`,
      userId: "user-a",
    };
  }

  /**
   * Serves the cursor lookup and the page query from separate row sets so a
   * single test can describe both halves of a cursor page.
   */
  function fakeChatDb(input: { cursor?: unknown; rows: unknown[] }) {
    let query = 0;
    const db: any = {
      select: () => {
        const rows = query === 0 && input.cursor ? [input.cursor] : input.rows;
        query += 1;
        const chain: any = {
          from: () => chain,
          limit: () => chain,
          orderBy: () => chain,
          // biome-ignore lint/suspicious/noThenProperty: awaitable fake query
          then: (resolve: unknown) => Promise.resolve(rows).then(resolve as never),
          where: () => chain,
        };
        return chain;
      },
    };
    return db;
  }

  it("returns the newest page oldest-first and reports more", async () => {
    const db = fakeChatDb({ rows: [row("chat-3"), row("chat-2"), row("chat-1")] });

    const page = await listChatMessagesForTable(db, "table-1", { limit: 2 });

    expect(page.hasMore).toBe(true);
    expect(page.messages.map((message) => message.id)).toEqual(["chat-2", "chat-3"]);
  });

  it("reports the last page as having nothing older", async () => {
    const db = fakeChatDb({ rows: [row("chat-2"), row("chat-1")] });

    const page = await listChatMessagesForTable(db, "table-1", { limit: 2 });

    expect(page.hasMore).toBe(false);
    expect(page.messages.map((message) => message.id)).toEqual(["chat-1", "chat-2"]);
  });

  it("pages older rows from a cursor", async () => {
    const db = fakeChatDb({ cursor: row("chat-3"), rows: [row("chat-1")] });

    const page = await listChatMessagesForTable(db, "table-1", { beforeId: "chat-3", limit: 2 });

    expect(page.messages.map((message) => message.id)).toEqual(["chat-1"]);
  });

  it("turns a stored row into a wire frame with an ISO timestamp", async () => {
    expect(toChatWire(row("chat-1"))).toEqual({
      createdAt: "2026-08-02T08:00:00.000Z",
      id: "chat-1",
      snapshot: { tableId: "table-1" },
      text: "text-chat-1",
      userId: "user-a",
    });
  });
});

describe("chat persistence surface", () => {
  it("writes one chat row and nothing else", async () => {
    const written: string[] = [];
    const db: any = {
      insert: (table: { [key: symbol]: unknown }) => {
        written.push(tableName(table));
        return { values: async () => undefined };
      },
    };

    await persistChatMessageToDb(db, {
      createdAt: new Date("2026-08-02T08:00:00.000Z"),
      snapshot: { tableId: "table-1" },
      tableId: "table-1",
      text: "hello",
      userId: "user-a",
    });

    expect(written).toEqual(["chat_message"]);
  });

  // M0-3: chat is not a game event. The chat path has no writer for `game` or
  // `game_event`, so a message can never advance `game.seq` — replay therefore
  // only ever sees game transitions.
  it("exposes no game-event writer", () => {
    expect(Object.keys(persistence).sort()).toEqual([
      "CHAT_PAGE_SIZE",
      "listChatMessagesForTable",
      "persistChatMessageToDb",
      "toChatWire",
    ]);
  });
});

function tableName(table: { [key: symbol]: unknown }) {
  const symbol = Object.getOwnPropertySymbols(table).find((key) => String(key).includes("Name"));
  return symbol ? String(table[symbol]) : "unknown";
}
