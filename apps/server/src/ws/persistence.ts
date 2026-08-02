import { desc, eq } from "drizzle-orm";

import type { Database } from "../db/client";
import { chatMessage, game, gameEvent } from "../db/schema";

type DbLike = Pick<Database, "select" | "insert" | "update" | "transaction">;

export async function persistChatMessageToDb(
  dbLike: DbLike,
  input: {
    tableId: string;
    userId: string;
    text: string;
    snapshot: unknown;
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

export async function listChatMessagesForTable(
  dbLike: Pick<Database, "select">,
  tableId: string,
  limit = 200,
) {
  const rows = await dbLike
    .select({
      id: chatMessage.id,
      userId: chatMessage.userId,
      text: chatMessage.text,
      snapshot: chatMessage.snapshot,
      createdAt: chatMessage.createdAt,
    })
    .from(chatMessage)
    .where(eq(chatMessage.tableId, tableId))
    .orderBy(desc(chatMessage.createdAt))
    .limit(limit);

  return [...rows].reverse();
}

export async function appendGameEventToDb(
  dbLike: DbLike & { select: any },
  input: {
    tableId: string;
    gameId?: string;
    payload: unknown;
    actorId: string;
    createdAt: Date;
  },
) {
  return await dbLike.transaction(async (tx: any) => {
    const [current] = await tx
      .select()
      .from(game)
      .where(eq(game.tableId, input.tableId))
      .orderBy(desc(game.createdAt), desc(game.id))
      .limit(1);
    if (!current) return { id: "" };

    const [lastEvent] = await tx
      .select()
      .from(gameEvent)
      .where(eq(gameEvent.gameRowId, current.id))
      .orderBy(desc(gameEvent.seq))
      .limit(1);
    const nextSeq = (lastEvent?.seq ?? current.seq) + 1;
    const id = crypto.randomUUID();
    await tx.insert(gameEvent).values({
      id,
      gameRowId: current.id,
      tableId: input.tableId,
      gameId: input.gameId ?? current.gameId,
      seq: nextSeq,
      type: "chat_sent",
      actorId: input.actorId,
      payload: input.payload,
      createdAt: input.createdAt,
    });
    await tx.update(game).set({ seq: nextSeq }).where(eq(game.id, current.id));
    return { id };
  });
}
