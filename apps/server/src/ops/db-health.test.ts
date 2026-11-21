import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Database } from "../db/client";
import { createLogger } from "../log";
import { countMigrationFiles, createDatabaseChecks } from "./db-health";

function fakeDb(count: number | Error) {
  const execute = vi.fn(async () => {
    if (count instanceof Error) throw count;
    return [{ count }];
  });
  return { db: { execute } as unknown as Database, execute };
}

function migrationsDirWith(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "rh-migrations-"));
  for (const file of files) writeFileSync(join(dir, file), "select 1;");
  return dir;
}

async function runCheck(
  checks: ReturnType<typeof createDatabaseChecks>,
  name: string,
): Promise<void> {
  const check = checks.find((candidate) => candidate.name === name);
  if (!check) throw new Error(`no check named ${name}`);
  await check.run();
}

describe("readiness checks", () => {
  it("counts only .sql migrations", () => {
    expect(countMigrationFiles(migrationsDirWith(["0000_a.sql", "0001_b.sql", "meta.json"]))).toBe(
      2,
    );
  });

  it("passes when the database answers and every migration is applied", async () => {
    const { db } = fakeDb(2);
    const checks = createDatabaseChecks({
      db,
      migrationsDir: migrationsDirWith(["a.sql", "b.sql"]),
    });

    await expect(runCheck(checks, "database")).resolves.toBeUndefined();
    await expect(runCheck(checks, "migrations")).resolves.toBeUndefined();
  });

  it("fails the database check with the driver's error", async () => {
    const { db } = fakeDb(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const checks = createDatabaseChecks({ db, migrationsDir: migrationsDirWith(["a.sql"]) });

    await expect(runCheck(checks, "database")).rejects.toThrow(/ECONNREFUSED/);
  });

  it("fails the migrations check when the database is behind the image", async () => {
    const { db } = fakeDb(1);
    const checks = createDatabaseChecks({
      db,
      migrationsDir: migrationsDirWith(["a.sql", "b.sql", "c.sql"]),
    });

    await expect(runCheck(checks, "migrations")).rejects.toThrow(
      "2 migration(s) pending (1/3 applied)",
    );
  });

  it("warns once and then fails when the migrations directory is unreadable", async () => {
    const lines: string[] = [];
    const { db } = fakeDb(2);
    const checks = createDatabaseChecks({
      db,
      logger: createLogger({ level: "debug", sink: (line) => lines.push(line) }),
      migrationsDir: join(tmpdir(), "rh-migrations-does-not-exist"),
    });

    await expect(runCheck(checks, "migrations")).rejects.toThrow(/cannot count migrations/);
    expect(lines.map((line) => JSON.parse(line).msg)).toContain("ready.migrations_unreadable");
  });
});
