import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createTablesRouter, TablesError } from "./tables";
import type { TablesRuntime } from "../room/runtime";

function makeRuntime(overrides: Partial<TablesRuntime> = {}): TablesRuntime {
  return {
    applyGameIntent: vi.fn(),
    createTable: vi.fn(),
    getTableSnapshot: vi.fn(),
    joinTable: vi.fn(),
    startTable: vi.fn(),
    rematchTable: vi.fn(),
    getMine: vi.fn(),
    ...overrides,
  };
}

function makeApp(runtime: TablesRuntime) {
  const app = new Hono();
  app.route(
    "/api/tables",
    createTablesRouter({
      runtime,
      getSessionFromHeaders: async () => ({ user: { id: "user-1" } }),
    }),
  );
  return app;
}

describe("tables http api", () => {
  it("returns unknown_game when the module is missing", async () => {
    const runtime = makeRuntime({
      createTable: vi.fn().mockRejectedValue(new TablesError("unknown_game", "unknown_game:poker")),
    });

    const res = await makeApp(runtime).request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ gameId: "poker", config: {} }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "unknown_game" });
  });

  it("returns table_full when a lobby is at capacity", async () => {
    const runtime = makeRuntime({
      joinTable: vi.fn().mockRejectedValue(new TablesError("table_full", "table_full")),
    });

    const res = await makeApp(runtime).request("/api/tables/join", {
      method: "POST",
      body: JSON.stringify({ code: "ABC123" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "table_full" });
  });

  it("rejects invalid yatzy config when creating a table", async () => {
    const runtime = makeRuntime();

    const res = await makeApp(runtime).request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ gameId: "yatzy", config: { ruleset: "poker" } }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "invalid_request" });
    expect(runtime.createTable).not.toHaveBeenCalled();
  });
});
