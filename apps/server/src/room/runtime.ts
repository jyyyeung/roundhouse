import { asc, desc, eq, inArray } from "drizzle-orm";
import type { ClientIntent, EventEnvelope, Json, TableMeta } from "@yatzy/game-core";
import { generateInviteCode } from "@yatzy/game-core";

import type { Database } from "../db/client";
import { game, gameEvent, gameTable, tablePlayer } from "../db/schema";
import { getModule } from "../modules/registry";

type TableRow = typeof gameTable.$inferSelect;
type GameRow = typeof game.$inferSelect;
type SeatRow = typeof tablePlayer.$inferSelect;
type DbLike = Pick<Database, "select" | "insert" | "update" | "transaction">;

export class TablesError extends Error {
  constructor(
    public code: string,
    message = code,
    public status = 400,
  ) {
    super(message);
    this.name = "TablesError";
  }
}

export type TableSummary = TableRow & {
  seatUserIds: string[];
  seats: SeatRow[];
  currentGame: GameRow | null;
};

export type TablesRuntime = {
  createTable(input: {
    userId: string;
    gameId: string;
    config: Json;
    softSeatCap?: number;
  }): Promise<{ tableId: string; code: string }>;
  joinTable(input: { userId: string; code: string }): Promise<{ tableId: string }>;
  startTable(input: { userId: string; tableId: string }): Promise<{ tableId: string; gameRowId: string }>;
  rematchTable(input: { userId: string; tableId: string }): Promise<{ tableId: string; gameRowId: string }>;
  getMine(input: { userId: string }): Promise<TableSummary[]>;
  getTableSnapshot(input: { tableId: string }): Promise<TableSnapshot | null>;
  applyGameIntent(input: {
    tableId: string;
    userId: string;
    intent: ClientIntent;
    randomInt?: (maxExclusive: number) => number;
    now?: () => Date;
  }): Promise<ApplyGameIntentResult>;
};

export type TableSnapshot = {
  tableId: string;
  seq: number;
  state: Json;
  meta: TableMeta;
};

export type ApplyGameIntentResult =
  | {
      ok: true;
      events: EventEnvelope[];
      finished: boolean;
      meta: TableMeta;
      seq: number;
      state: Json;
    }
  | {
      ok: false;
      code: string;
      message: string;
      seq: number;
    };

async function loadTableById(db: DbLike, tableId: string) {
  const [row] = await db.select().from(gameTable).where(eq(gameTable.id, tableId)).limit(1);
  if (!row) return null;

  const seats = await db
    .select()
    .from(tablePlayer)
    .where(eq(tablePlayer.tableId, tableId))
    .orderBy(asc(tablePlayer.seatIndex));

  const [currentGame] = await db
    .select()
    .from(game)
    .where(eq(game.tableId, tableId))
    .orderBy(desc(game.createdAt), desc(game.id))
    .limit(1);

  return {
    ...row,
    seats,
    seatUserIds: seats.map((seat) => seat.userId),
    currentGame: currentGame ?? null,
  } satisfies TableSummary;
}

async function loadTableByCode(db: DbLike, code: string) {
  const [row] = await db.select().from(gameTable).where(eq(gameTable.code, code)).limit(1);
  if (!row) return null;
  return loadTableById(db, row.id);
}

async function loadCurrentGame(db: DbLike, tableId: string) {
  const [row] = await db
    .select()
    .from(game)
    .where(eq(game.tableId, tableId))
    .orderBy(desc(game.createdAt), desc(game.id))
    .limit(1);
  return row ?? null;
}

function resolveTableStatus(table: TableSummary, currentGame: GameRow | null) {
  if (currentGame?.status === "finished") return "finished";
  return table.status;
}

function toTableMeta(table: TableSummary, currentGame: GameRow | null): TableMeta {
  return {
    code: table.code,
    config: table.config as Json,
    gameId: table.gameId,
    hostUserId: table.hostUserId,
    seatUserIds: table.seatUserIds,
    softSeatCap: table.softSeatCap,
    status: resolveTableStatus(table, currentGame),
  };
}

async function loadRecentTables(db: DbLike, userId: string) {
  const hostedTables = await db
    .select()
    .from(gameTable)
    .where(eq(gameTable.hostUserId, userId))
    .orderBy(desc(gameTable.createdAt));

  const joinedTableIds = await db
    .select({ tableId: tablePlayer.tableId })
    .from(tablePlayer)
    .where(eq(tablePlayer.userId, userId));

  const joinedIds = [...new Set(joinedTableIds.map((row) => row.tableId))];
  const joinedTables =
    joinedIds.length === 0
      ? []
      : await db
          .select()
          .from(gameTable)
          .where(inArray(gameTable.id, joinedIds));

  const tablesById = new Map<string, TableRow>();
  for (const row of hostedTables) tablesById.set(row.id, row);
  for (const row of joinedTables) tablesById.set(row.id, row);

  const tables = [...tablesById.values()].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );

  return Promise.all(
    tables.map(async (row) => {
      const summary = await loadTableById(db, row.id);
      if (!summary) throw new TablesError("table_missing", "table_missing", 404);
      return summary;
    }),
  );
}

export function createRoomRuntime(db: Database): TablesRuntime {
  return {
    async createTable({ userId, gameId, config, softSeatCap = 4 }) {
      let module;
      try {
        module = getModule(gameId);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("unknown_game:")) {
          throw new TablesError("unknown_game", error.message);
        }
        throw error;
      }

      return db.transaction(async (tx) => {
        const tableId = crypto.randomUUID();
        const code = generateInviteCode();
        const createdAt = new Date();

        await tx.insert(gameTable).values({
          id: tableId,
          code,
          gameId,
          config,
          status: "lobby",
          hostUserId: userId,
          softSeatCap,
          createdAt,
        });

        await tx.insert(tablePlayer).values({
          tableId,
          userId,
          seatIndex: 0,
        });

        return { tableId, code };
      });
    },

    async joinTable({ userId, code }) {
      return db.transaction(async (tx) => {
        const table = await loadTableByCode(tx, code);
        if (!table) throw new TablesError("unknown_table", "unknown_table", 404);
        if (table.status !== "lobby") throw new TablesError("table_closed", "table_closed");
        if (table.seatUserIds.includes(userId)) return { tableId: table.id };
        if (table.seatUserIds.length >= table.softSeatCap) {
          throw new TablesError("table_full", "table_full");
        }

        await tx.insert(tablePlayer).values({
          tableId: table.id,
          userId,
          seatIndex: table.seatUserIds.length,
        });

        return { tableId: table.id };
      });
    },

    async startTable({ userId, tableId }) {
      return db.transaction(async (tx) => {
        const table = await loadTableById(tx, tableId);
        if (!table) throw new TablesError("table_missing", "table_missing", 404);
        if (table.hostUserId !== userId) throw new TablesError("not_host", "not_host", 403);
        if (table.status !== "lobby") throw new TablesError("table_not_lobby", "table_not_lobby");
        if (table.seatUserIds.length < 2) throw new TablesError("not_enough_players", "not_enough_players");

        let module;
        try {
          module = getModule(table.gameId);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("unknown_game:")) {
            throw new TablesError("unknown_game", error.message);
          }
          throw error;
        }
        const state = module.createInitialState(
          { ...(table.config as object), tableId: table.id } as Json,
          table.seatUserIds,
        );
        const gameRowId = crypto.randomUUID();
        const createdAt = new Date();

        await tx.insert(game).values({
          id: gameRowId,
          tableId,
          gameId: table.gameId,
          state,
          seq: 0,
          status: "active",
          createdAt,
        });

        await tx
          .update(gameTable)
          .set({ status: "active" })
          .where(eq(gameTable.id, tableId));

        return { tableId, gameRowId };
      });
    },

    async rematchTable({ userId, tableId }) {
      return db.transaction(async (tx) => {
        const table = await loadTableById(tx, tableId);
        if (!table) throw new TablesError("table_missing", "table_missing", 404);
        if (!table.seatUserIds.includes(userId)) throw new TablesError("not_a_player", "not_a_player", 403);

        const currentGame = await loadCurrentGame(tx, tableId);
        if (!currentGame || currentGame.status !== "finished") {
          throw new TablesError("rematch_unavailable", "rematch_unavailable");
        }

        let module;
        try {
          module = getModule(table.gameId);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("unknown_game:")) {
            throw new TablesError("unknown_game", error.message);
          }
          throw error;
        }
        const state = module.createInitialState(
          { ...(table.config as object), tableId: table.id } as Json,
          table.seatUserIds,
        );
        const gameRowId = crypto.randomUUID();
        const createdAt = new Date();

        await tx.insert(game).values({
          id: gameRowId,
          tableId,
          gameId: table.gameId,
          state,
          seq: 0,
          status: "active",
          createdAt,
        });

        await tx
          .update(gameTable)
          .set({ status: "active" })
          .where(eq(gameTable.id, tableId));

        return { tableId, gameRowId };
      });
    },

    getMine({ userId }) {
      return loadRecentTables(db, userId);
    },

    async getTableSnapshot({ tableId }) {
      const table = await loadTableById(db, tableId);
      if (!table) return null;

      const currentGame = table.currentGame;
      return {
        tableId,
        meta: toTableMeta(table, currentGame),
        seq: currentGame?.seq ?? 0,
        state: (currentGame?.state ?? null) as Json,
      };
    },

    async applyGameIntent({ tableId, userId, intent, randomInt = defaultRandomInt, now = () => new Date() }) {
      return db.transaction(async (tx) => {
        const table = await loadTableById(tx, tableId);
        if (!table) {
          return { ok: false, code: "table_missing", message: "table_missing", seq: 0 } satisfies ApplyGameIntentResult;
        }
        if (!table.seatUserIds.includes(userId)) {
          return {
            ok: false,
            code: "not_a_player",
            message: "not_a_player",
            seq: table.currentGame?.seq ?? 0,
          } satisfies ApplyGameIntentResult;
        }

        const currentGame = table.currentGame;
        if (!currentGame) {
          return {
            ok: false,
            code: "game_missing",
            message: "game_missing",
            seq: 0,
          } satisfies ApplyGameIntentResult;
        }

        let module;
        try {
          module = getModule(currentGame.gameId);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("unknown_game:")) {
            return {
              ok: false,
              code: "unknown_game",
              message: error.message,
              seq: currentGame.seq,
            } satisfies ApplyGameIntentResult;
          }
          throw error;
        }

        const reduced = module.reduce(currentGame.state as Json, intent, {
          actorId: userId,
          now,
          playerIds: table.seatUserIds,
          randomInt,
        });
        if (!reduced.ok) {
          return {
            ok: false,
            code: "illegal_action",
            message: reduced.error,
            seq: currentGame.seq,
          } satisfies ApplyGameIntentResult;
        }

        const createdAt = now();
        const createdAtIso = createdAt.toISOString();
        const events = reduced.events.map<EventEnvelope>((event, index) => ({
          ...event,
          id: crypto.randomUUID(),
          seq: currentGame.seq + index + 1,
          createdAt: createdAtIso,
        }));
        const finished = module.isFinished(reduced.state);
        const nextSeq = currentGame.seq + events.length;

        if (events.length > 0) {
          await tx.insert(gameEvent).values(
            events.map((event) => ({
              actorId: event.actorId,
              createdAt,
              gameId: event.gameId,
              gameRowId: currentGame.id,
              id: event.id,
              payload: event.payload,
              seq: event.seq,
              tableId: event.tableId,
              type: event.type,
            })),
          );
        }

        await tx
          .update(game)
          .set({
            finishedAt: finished ? createdAt : null,
            seq: nextSeq,
            state: reduced.state,
            status: finished ? "finished" : "active",
          })
          .where(eq(game.id, currentGame.id));

        await tx
          .update(gameTable)
          .set({ status: finished ? "finished" : "active" })
          .where(eq(gameTable.id, tableId));

        return {
          ok: true,
          events,
          finished,
          meta: toTableMeta(table, { ...currentGame, seq: nextSeq, status: finished ? "finished" : "active" }),
          seq: nextSeq,
          state: reduced.state,
        } satisfies ApplyGameIntentResult;
      });
    },
  };
}

export type { TableRow, GameRow, SeatRow };

function defaultRandomInt(maxExclusive: number) {
  if (maxExclusive <= 0) throw new Error("maxExclusive");
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0]! % maxExclusive;
}
