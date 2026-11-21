import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { ClientIntent, EventEnvelope, Json, RawGameState, TableMeta, ViewerView } from "@roundhouse/game-core";
import { generateInviteCode, parseIntent } from "@roundhouse/game-core";

import type { Database } from "../db/client";
import { game, gameEvent, gameTable, tablePlayer } from "../db/schema";
import { getModule } from "../modules/registry";
import { projectSnapshot, rawGameState, viewerForUser } from "./projection";

type TableRow = typeof gameTable.$inferSelect;
type GameRow = typeof game.$inferSelect;
type SeatRow = typeof tablePlayer.$inferSelect;
type GameEventRow = typeof gameEvent.$inferSelect;
type DbLike = Pick<Database, "select" | "insert" | "update" | "transaction" | "execute">;

/**
 * Projects stored game state for one viewer. Returns null (rather than throwing)
 * when the table has no game yet or its module is not registered: a lobby table
 * is a legitimate state, and a broken gameId must not take the whole broadcast
 * down with it.
 */
function projectForViewer(currentGame: GameRow | null, viewer: ViewerView): Json {
  if (!currentGame) return null;

  let module;
  try {
    module = getModule(currentGame.gameId);
  } catch {
    return null;
  }

  return projectSnapshot(module, rawGameState(currentGame.state), viewer);
}

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
  getTableSnapshot(input: { tableId: string; asUserId: string | null }): Promise<TableSnapshot | null>;
  getTableSync(input: { tableId: string; asUserId: string | null; sinceSeq: number }): Promise<TableSync | null>;
  getTableLiveState(input: { tableId: string }): Promise<TableLiveState | null>;
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

/** Events a `sync` may replay before the hub falls back to a full snapshot. */
export const SYNC_REPLAY_LIMIT = 200;

/**
 * Answer to a gap repair (ADR 0003). Either the missed frames are replayed from
 * the event log, or the gap is too big (or the log too holey) and the caller
 * starts over from `snapshot`. Both branches carry authoritative state, so a
 * client can never end up "synced" on invented state.
 */
export type TableSync =
  | {
      kind: "events";
      tableId: string;
      fromSeq: number;
      toSeq: number;
      state: Json;
      meta: TableMeta;
      events: EventEnvelope[];
    }
  | { kind: "snapshot"; tableId: string; seq: number; state: Json; meta: TableMeta };

/** Unprojected live state: the hub projects it per socket after an HTTP mutation. */
export type TableLiveState = { tableId: string; seq: number; state: RawGameState | null; meta: TableMeta };

export type ApplyGameIntentResult =
  | {
      ok: true;
      events: EventEnvelope[];
      finished: boolean;
      meta: TableMeta;
      seq: number;
      // Unprojected: the caller must project per socket before sending.
      state: RawGameState;
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

async function lockTableById(db: DbLike, tableId: string) {
  await db.execute(sql`select ${gameTable.id} from ${gameTable} where ${gameTable.id} = ${tableId} for update`);
}

async function lockTableByCode(db: DbLike, code: string) {
  await db.execute(sql`select ${gameTable.id} from ${gameTable} where ${gameTable.code} = ${code} for update`);
}

/** Stored event row → wire envelope. The inverse of nothing yet: #13 adds fold. */
function toEventEnvelope(row: GameEventRow): EventEnvelope {
  return {
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
    gameId: row.gameId,
    id: row.id,
    payload: row.payload,
    seq: row.seq,
    tableId: row.tableId,
    type: row.type,
  };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

function resolveTableStatus(table: TableSummary, currentGame: GameRow | null) {
  if (currentGame?.status === "finished") return "finished";
  return table.status;
}

function toTableMeta(table: TableSummary, currentGame: GameRow | null): TableMeta {
  return {
    code: table.code,
    config: table.config,
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
        await lockTableByCode(tx, code);
        const table = await loadTableByCode(tx, code);
        if (!table) throw new TablesError("unknown_table", "unknown_table", 404);
        // Already seated: allow re-open of active/finished tables (lobby links always pass ?code=).
        if (table.seatUserIds.includes(userId)) return { tableId: table.id };
        if (table.status !== "lobby") throw new TablesError("table_closed", "table_closed");
        if (table.seatUserIds.length >= table.softSeatCap) {
          throw new TablesError("table_full", "table_full");
        }

        try {
          await tx.insert(tablePlayer).values({
            tableId: table.id,
            userId,
            seatIndex: table.seatUserIds.length,
          });
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }

          const refreshedTable = await loadTableById(tx, table.id);
          if (refreshedTable?.seatUserIds.includes(userId)) {
            return { tableId: table.id };
          }
          throw new TablesError("table_full", "table_full");
        }

        return { tableId: table.id };
      });
    },

    async startTable({ userId, tableId }) {
      return db.transaction(async (tx) => {
        await lockTableById(tx, tableId);
        const table = await loadTableById(tx, tableId);
        if (!table) throw new TablesError("table_missing", "table_missing", 404);
        if (table.hostUserId !== userId) throw new TablesError("not_host", "not_host", 403);
        if (table.currentGame?.status === "active") {
          return { tableId, gameRowId: table.currentGame.id };
        }
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
        await lockTableById(tx, tableId);
        const table = await loadTableById(tx, tableId);
        if (!table) throw new TablesError("table_missing", "table_missing", 404);
        if (!table.seatUserIds.includes(userId)) throw new TablesError("not_a_player", "not_a_player", 403);
        if (table.currentGame?.status === "active") {
          return { tableId, gameRowId: table.currentGame.id };
        }
        if (!table.currentGame || resolveTableStatus(table, table.currentGame) !== "finished") {
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

    async getTableSnapshot({ tableId, asUserId }) {
      const table = await loadTableById(db, tableId);
      if (!table) return null;
      const currentGame = table.currentGame;
      const meta = toTableMeta(table, currentGame);

      return {
        tableId,
        meta,
        seq: currentGame?.seq ?? 0,
        state: projectForViewer(currentGame, viewerForUser(table.seatUserIds, asUserId)),
      };
    },

    async getTableLiveState({ tableId }) {
      const table = await loadTableById(db, tableId);
      if (!table) return null;
      const currentGame = table.currentGame;

      return {
        meta: toTableMeta(table, currentGame),
        seq: currentGame?.seq ?? 0,
        state: currentGame ? rawGameState(currentGame.state) : null,
        tableId,
      };
    },

    async getTableSync({ tableId, asUserId, sinceSeq }) {
      const table = await loadTableById(db, tableId);
      if (!table) return null;

      const currentGame = table.currentGame;
      const meta = toTableMeta(table, currentGame);
      const viewer = viewerForUser(table.seatUserIds, asUserId);
      const toSeq = currentGame?.seq ?? 0;
      const snapshot: TableSync = {
        kind: "snapshot",
        meta,
        seq: toSeq,
        state: projectForViewer(currentGame, viewer),
        tableId,
      };

      // No game yet, or nothing missed: answer with the current state and no
      // events, so "sync" always terminates even when the client is ahead.
      if (!currentGame || sinceSeq >= toSeq) {
        return {
          events: [],
          fromSeq: Math.min(sinceSeq, toSeq),
          kind: "events",
          meta,
          state: projectForViewer(currentGame, viewer),
          tableId,
          toSeq,
        } satisfies TableSync;
      }

      // A gap wider than the replay budget is cheaper to answer with one snapshot
      // than with a page of events the client would have to fold.
      if (toSeq - sinceSeq > SYNC_REPLAY_LIMIT) {
        return snapshot;
      }

      const rows = await db
        .select()
        .from(gameEvent)
        .where(and(eq(gameEvent.gameRowId, currentGame.id), gt(gameEvent.seq, sinceSeq)))
        .orderBy(asc(gameEvent.seq))
        .limit(SYNC_REPLAY_LIMIT);

      // The replay has to cover the whole gap. A pruned or half-written log would
      // leave a hole the client cannot detect, so fall back to the snapshot.
      if (rows.length !== toSeq - sinceSeq) {
        return snapshot;
      }

      return {
        events: rows.map(toEventEnvelope),
        fromSeq: sinceSeq,
        kind: "events",
        meta,
        state: projectForViewer(currentGame, viewer),
        tableId,
        toSeq,
      } satisfies TableSync;
    },

    async applyGameIntent({ tableId, userId, intent, randomInt = defaultRandomInt, now = () => new Date() }) {
      return db.transaction(async (tx) => {
        // Serialise intents per table: reduce() reads seq and state, then writes both.
        // Without this lock two concurrent intents compute from the same seq and
        // collide on game_event_game_row_id_seq_idx (or lose the state update).
        await lockTableById(tx, tableId);
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

        // Reject anything the module never declared before reduce can touch state:
        // the wire carries an arbitrary intent name and payload shape otherwise.
        const parsedIntent = parseIntent(module.intents, intent);
        if (!parsedIntent.ok) {
          return {
            ok: false,
            code: parsedIntent.code,
            message: parsedIntent.detail,
            seq: currentGame.seq,
          } satisfies ApplyGameIntentResult;
        }

        const reduced = module.reduce(currentGame.state, parsedIntent.intent, {
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
          state: rawGameState(reduced.state)!,
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
