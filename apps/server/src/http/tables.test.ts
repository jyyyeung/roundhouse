import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { TablesRuntime } from "../room/runtime";
import { createTablesRouter, TablesError } from "./tables";

function makeRuntime(overrides: Partial<TablesRuntime> = {}): TablesRuntime {
  return {
    applyGameIntent: vi.fn(),
    createTable: vi.fn(),
    getTableLiveState: vi.fn(),
    getTableSnapshot: vi.fn(),
    getTableSync: vi.fn(),
    joinTable: vi.fn(),
    startTable: vi.fn(),
    rematchTable: vi.fn(),
    getMine: vi.fn(),
    ...overrides,
  };
}

function makeApp(runtime: TablesRuntime, onTableChanged?: (tableId: string) => void) {
  const app = new Hono();
  app.route(
    "/api/tables",
    createTablesRouter({
      runtime,
      getSessionFromHeaders: async () => ({ user: { id: "user-1" } }),
      onTableChanged,
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

  it("defaults the config to the module's default when the caller sends none", async () => {
    const createTable = vi.fn().mockResolvedValue({ code: "ABC123", tableId: "table-1" });

    const res = await makeApp(makeRuntime({ createTable })).request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ gameId: "yatzy" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(201);
    // The default is the module's, not a literal in this router: the game that
    // owns the config declares what an untouched table looks like.
    expect(createTable).toHaveBeenCalledWith(
      expect.objectContaining({ config: { ruleset: "yatzy" }, gameId: "yatzy" }),
    );
  });

  it("validates the config with the module's schema rather than a known game id", async () => {
    const runtime = makeRuntime();

    const res = await makeApp(runtime).request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ gameId: "yatzy", config: { ruleset: "yatzy" } }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(runtime.createTable).toHaveBeenCalledWith(
      expect.objectContaining({ config: { ruleset: "yatzy" } }),
    );
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

  it("pushes the new seat list when someone joins", async () => {
    const runtime = makeRuntime({
      joinTable: vi.fn().mockResolvedValue({ tableId: "table-1" }),
    });
    const onTableChanged = vi.fn();

    const res = await makeApp(runtime, onTableChanged).request("/api/tables/join", {
      method: "POST",
      body: JSON.stringify({ code: "ABC123" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(onTableChanged).toHaveBeenCalledWith("table-1");
  });

  it("does not push when the join is refused", async () => {
    const runtime = makeRuntime({
      joinTable: vi.fn().mockRejectedValue(new TablesError("table_full", "table_full")),
    });
    const onTableChanged = vi.fn();

    const res = await makeApp(runtime, onTableChanged).request("/api/tables/join", {
      method: "POST",
      body: JSON.stringify({ code: "ABC123" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(onTableChanged).not.toHaveBeenCalled();
  });
});
