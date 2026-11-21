import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createLogger } from "../log";
import {
  createLivenessHandler,
  createReadinessHandler,
  type ProbeCheck,
  type ReadyResponse,
} from "./probes";

function readyApp(checks: ProbeCheck[], timeoutMs?: number) {
  const lines: string[] = [];
  const app = new Hono();
  app.get(
    "/ready",
    createReadinessHandler({
      checks,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      logger: createLogger({ level: "debug", sink: (line) => lines.push(line) }),
    }),
  );
  return { app, lines: () => lines.map((line) => JSON.parse(line)) };
}

const healthy: ProbeCheck = { name: "database", run: async () => {} };

describe("liveness probe", () => {
  it("answers without touching a dependency", async () => {
    const app = new Hono();
    app.get("/health", createLivenessHandler());

    const response = await app.request("/health");
    const body = (await response.json()) as { ok: boolean; uptimeSeconds: number };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.uptimeSeconds).toBe("number");
  });
});

describe("readiness probe", () => {
  it("returns 200 and per-check timings when every check passes", async () => {
    const { app } = readyApp([healthy, { name: "migrations", run: async () => {} }]);

    const response = await app.request("/ready");
    const body = (await response.json()) as ReadyResponse;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checks.map((check) => check.name)).toEqual(["database", "migrations"]);
    expect(body.checks.every((check) => check.ok && check.durationMs >= 0)).toBe(true);
  });

  it("returns 503 naming the failing check and the reason", async () => {
    const { app, lines } = readyApp([
      healthy,
      {
        name: "migrations",
        run: async () => {
          throw new Error("1 migration(s) pending (1/2 applied)");
        },
      },
    ]);

    const response = await app.request("/ready");
    const body = (await response.json()) as ReadyResponse;

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.checks[1]).toMatchObject({
      name: "migrations",
      ok: false,
      reason: "1 migration(s) pending (1/2 applied)",
    });
    expect(lines()).toContainEqual(
      expect.objectContaining({
        check: "migrations",
        level: "warn",
        msg: "ready.check_failed",
      }),
    );
  });

  it("answers within the deadline when a dependency hangs", async () => {
    const hang: ProbeCheck = { name: "database", run: () => new Promise<void>(() => {}) };
    const { app } = readyApp([hang], 20);

    const startedAt = Date.now();
    const response = await app.request("/ready");
    const elapsed = Date.now() - startedAt;
    const body = (await response.json()) as ReadyResponse;

    expect(response.status).toBe(503);
    expect(body.checks[0]).toMatchObject({ name: "database", ok: false });
    expect(body.checks[0].ok === false && body.checks[0].reason).toContain(
      "did not finish within 20ms",
    );
    expect(elapsed).toBeLessThan(1000);
  });

  it("runs every check concurrently, so the wait is one deadline and not one per check", async () => {
    const hang = (name: string): ProbeCheck => ({
      name,
      run: () => new Promise<void>(() => {}),
    });
    // Three checks that never settle: run one after another they would take
    // 3 x the deadline, run together they cost one. The bound sits between the
    // two with room for a loaded CI box, so this cannot pass sequentially.
    const { app } = readyApp([hang("a"), hang("b"), hang("c")], 40);

    const startedAt = Date.now();
    const response = await app.request("/ready");
    const elapsed = Date.now() - startedAt;

    expect(response.status).toBe(503);
    expect(elapsed).toBeLessThan(100);
  });

  it("survives a check that throws synchronously", async () => {
    const { app } = readyApp([
      {
        name: "database",
        run: () => {
          throw new Error("connection refused");
        },
      },
    ]);

    const response = await app.request("/ready");
    const body = (await response.json()) as ReadyResponse;

    expect(response.status).toBe(503);
    expect(body.checks[0]).toMatchObject({ ok: false, reason: "connection refused" });
  });
});
