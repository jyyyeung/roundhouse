import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";

import type { Database } from "../db/client";
import type { Logger } from "../log";
import type { ProbeCheck } from "./probes";

/** `apps/server/drizzle` next to `src/`, resolved from this module rather than cwd. */
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle/", import.meta.url));

/**
 * The number of migrations this build expects to find applied.
 *
 * Drizzle's runner records one row per applied migration in
 * `drizzle.__drizzle_migrations`, so comparing that count with the `.sql` files
 * shipped in the image is enough to catch the failure that actually happens: a
 * new image deployed against a database nobody migrated. It is a count, not a
 * checksum — a hand-edited migration that was already applied is not detected,
 * because detecting that needs the journal and a claim about ordering that the
 * readiness endpoint has no business making every second.
 */
export function countMigrationFiles(dir: string): number {
  return readdirSync(dir).filter((entry) => entry.endsWith(".sql")).length;
}

export function createDatabaseChecks(input: {
  db: Database;
  migrationsDir?: string;
  logger?: Logger;
}): ProbeCheck[] {
  const { db } = input;
  const migrationsDir = input.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;

  let expected: number | null = null;
  try {
    expected = countMigrationFiles(migrationsDir);
  } catch (error) {
    input.logger?.warn("ready.migrations_unreadable", {
      dir: migrationsDir,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  return [
    {
      name: "database",
      run: async () => {
        await db.execute(sql`select 1`);
      },
    },
    {
      name: "migrations",
      run: async () => {
        if (expected === null) {
          throw new Error(`cannot count migrations in ${migrationsDir}`);
        }

        const rows = (await db.execute(
          sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
        )) as unknown as Array<{ count: number }>;
        const applied = Number(rows[0]?.count ?? 0);

        if (applied < expected) {
          throw new Error(
            `${expected - applied} migration(s) pending (${applied}/${expected} applied)`,
          );
        }
      },
    },
  ];
}
