import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Logger } from "../log";
import type { Database } from "./client";

export const DEFAULT_MIGRATIONS_DIR = new URL("../../drizzle/", import.meta.url).pathname;

export type MigrationResult = { durationMs: number };

/**
 * Apply pending migrations in-process, before the server accepts traffic.
 *
 * In-process rather than through `drizzle-kit migrate` so that a failure is a
 * JSON log line and a `/ready` answer instead of a container that exits before
 * it can say what went wrong. Failing here is deliberately not fatal: a server
 * that starts and reports `503` on `/ready` is diagnosable, while a crash loop
 * hides the reason behind restart noise.
 */
export async function runMigrations(
  db: Database,
  log: Logger,
  migrationsFolder: string = DEFAULT_MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const startedAt = Date.now();
  await migrate(db, { migrationsFolder });
  const result = { durationMs: Date.now() - startedAt };
  log.info("migrate.done", result);
  return result;
}
