import { and, desc, eq, lt, or } from "drizzle-orm";
import type { ChatWire, Json } from "@roundhouse/game-core";

import type { Database } from "../db/client";
import { chatMessage } from "../db/schema";

// Chat may only ever insert chat rows. Dropping `update` and `transaction` from
// this type is deliberate: the chat path has no way to touch `game` or
// `game_event`, so it cannot bump `seq` (M0-3).
type DbLike = Pick<Database, "select" | "insert">;

/** Newest page of chat, and the page size an older page asks for. */
export const CHAT_PAGE_SIZE = 50;

export type ChatPage = { messages: ChatWire[]; hasMore: boolean };
export async function persistChatMessageToDb(
  dbLike: DbLike,
  input: {
    tableId: string;
    userId: string;
    text: string;
    snapshot: Json;
    createdAt: Date;
  },
) {
  const id = crypto.randomUUID();
  await dbLike.insert(chatMessage).values({
    id,
    tableId: input.tableId,
    userId: input.userId,
    text: input.text,
    snapshot: input.snapshot,
    createdAt: input.createdAt,
  });
  return { id, createdAt: input.createdAt.toISOString() };
}

/**
 * One page of chat, oldest-first, plus whether an older page exists.
 *
 * `beforeId` is the oldest message the caller already holds. Rows are ordered by
 * (createdAt, id) so a page boundary inside the same millisecond is still
 * deterministic; an unknown cursor restarts at the newest page, which the client
 * collapses because messages are keyed by id.
 */
export async function listChatMessagesForTable(
  dbLike: Pick<Database, "select">,
  tableId: string,
  options: { beforeId?: string; limit?: number } = {},
): Promise<ChatPage> {
  const limit = options.limit ?? CHAT_PAGE_SIZE;
  const cursor = options.beforeId ? await loadChatCursor(dbLike, tableId, options.beforeId) : null;

  const rows = await dbLike
    .select({
      id: chatMessage.id,
      userId: chatMessage.userId,
      text: chatMessage.text,
      snapshot: chatMessage.snapshot,
      createdAt: chatMessage.createdAt,
    })
    .from(chatMessage)
    .where(
      cursor
        ? and(
            eq(chatMessage.tableId, tableId),
            or(
              lt(chatMessage.createdAt, cursor.createdAt),
              and(eq(chatMessage.createdAt, cursor.createdAt), lt(chatMessage.id, cursor.id)),
            ),
          )
        : eq(chatMessage.tableId, tableId),
    )
    .orderBy(desc(chatMessage.createdAt), desc(chatMessage.id))
    // One row past the page is how "is there an older page?" is answered.
    .limit(limit + 1);

  const page = rows.slice(0, limit).reverse();
  return { hasMore: rows.length > limit, messages: page.map(toChatWire) };
}

async function loadChatCursor(dbLike: Pick<Database, "select">, tableId: string, beforeId: string) {
  const [row] = await dbLike
    .select({ createdAt: chatMessage.createdAt, id: chatMessage.id })
    .from(chatMessage)
    .where(and(eq(chatMessage.tableId, tableId), eq(chatMessage.id, beforeId)))
    .limit(1);
  return row ?? null;
}

/** The only place a chat row becomes a wire frame: broadcast, echo and pages share it. */
export function toChatWire(row: {
  id: string;
  userId: string;
  text: string;
  snapshot: Json;
  createdAt: Date;
}): ChatWire {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    snapshot: row.snapshot,
    text: row.text,
    userId: row.userId,
  };
}

