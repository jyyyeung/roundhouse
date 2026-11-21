import type { Database } from "../../db/client";
import { game, gameEvent, gameTable, tablePlayer } from "../../db/schema";

export type FakeDbCall = {
  op: "select" | "insert" | "update" | "execute";
  table?: string;
  sql?: string;
};

export type FakeDbSeed = {
  table?: Record<string, unknown> | null;
  seats?: Record<string, unknown>[];
  game?: Record<string, unknown> | null;
};

const tableNames = new Map<unknown, string>([
  [gameTable, "game_table"],
  [tablePlayer, "table_player"],
  [game, "game"],
  [gameEvent, "game_event"],
]);

function tableName(table: unknown) {
  return tableNames.get(table) ?? "unknown";
}

/**
 * Reads drizzle `sql` template chunks back into text so tests can assert on the
 * statement (e.g. that a row lock was actually taken).
 */
function extractSql(query: unknown) {
  const chunks = (query as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return String(query);

  return chunks
    .map((chunk) => {
      if (typeof chunk === "string") return chunk;
      const value = (chunk as { value?: unknown } | null)?.value;
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value.join("");
      return "";
    })
    .join(" ");
}

/**
 * Minimal stand-in for the drizzle client: it records the order of operations and
 * serves seeded rows, so runtime invariants that are about *sequencing* (locks
 * before reads) can be tested without a database. Row-level concurrency still
 * needs M0-5's real Postgres suite.
 */
export function createFakeDb(seed: FakeDbSeed) {
  const calls: FakeDbCall[] = [];

  const rowsFor = (table: unknown): unknown[] => {
    if (table === gameTable) return seed.table ? [seed.table] : [];
    if (table === tablePlayer) return seed.seats ?? [];
    if (table === game) return seed.game ? [seed.game] : [];
    return [];
  };

  const api = {
    select() {
      return {
        from(table: unknown) {
          calls.push({ op: "select", table: tableName(table) });
          const rows = rowsFor(table);

          const chain = {
            where() {
              return chain;
            },
            orderBy() {
              return chain;
            },
            limit() {
              return chain;
            },
            offset() {
              return chain;
            },
            then(onFulfilled: unknown, onRejected: unknown) {
              return Promise.resolve(rows).then(
                onFulfilled as (value: unknown) => unknown,
                onRejected as (reason: unknown) => unknown,
              );
            },
          };

          return chain;
        },
      };
    },
    insert(table: unknown) {
      calls.push({ op: "insert", table: tableName(table) });
      return {
        values() {
          return Promise.resolve(undefined);
        },
      };
    },
    update(table: unknown) {
      calls.push({ op: "update", table: tableName(table) });
      return {
        set() {
          return {
            where() {
              return Promise.resolve(undefined);
            },
          };
        },
      };
    },
    execute(query: unknown) {
      calls.push({ op: "execute", sql: extractSql(query) });
      return Promise.resolve([]);
    },
  };

  const db = {
    ...api,
    transaction(callback: (tx: typeof api) => Promise<unknown>) {
      return callback(api);
    },
  };

  return { db: db as unknown as Database, calls };
}
