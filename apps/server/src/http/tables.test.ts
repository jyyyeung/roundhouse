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
    leaveTable: vi.fn(),
    kickTablePlayer: vi.fn(),
    getMine: vi.fn(),
    ...overrides,
  };
}

function makeApp(
  runtime: TablesRuntime,
  onTableChanged?: (tableId: string) => void,
  onSeatRemoved?: (tableId: string, userId: string, reason: "left" | "kicked") => void,
  options: { emailVerified?: boolean; requireVerification?: boolean } = {},
) {
  const app = new Hono();
  app.route(
    "/api/tables",
    createTablesRouter({
      runtime,
      getSessionFromHeaders: async () => ({
        user: { emailVerified: options.emailVerified ?? false, id: "user-1" },
      }),
      onTableChanged,
      onSeatRemoved,
      requireVerification: options.requireVerification ?? false,
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

function seatChange(overrides: Record<string, unknown> = {}) {
  return {
    hostUserId: "user-1",
    removed: true,
    seatsRemaining: 1,
    tableDeleted: false,
    tableId: "table-1",
    ...overrides,
  };
}

describe("tables http api: leaving and kicking", () => {
  it("leaving pushes the new seat list and evicts the leaver", async () => {
    const runtime = makeRuntime({
      leaveTable: vi.fn().mockResolvedValue(seatChange()),
    });
    const onTableChanged = vi.fn();
    const onSeatRemoved = vi.fn();

    const res = await makeApp(runtime, onTableChanged, onSeatRemoved).request(
      "/api/tables/table-1/leave",
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(runtime.leaveTable).toHaveBeenCalledWith({ tableId: "table-1", userId: "user-1" });
    expect(onTableChanged).toHaveBeenCalledWith("table-1");
    expect(onSeatRemoved).toHaveBeenCalledWith("table-1", "user-1", "left");
  });

  it("leaving does not push state for a table that no longer exists", async () => {
    const runtime = makeRuntime({
      leaveTable: vi
        .fn()
        .mockResolvedValue(seatChange({ hostUserId: null, seatsRemaining: 0, tableDeleted: true })),
    });
    const onTableChanged = vi.fn();
    const onSeatRemoved = vi.fn();

    const res = await makeApp(runtime, onTableChanged, onSeatRemoved).request(
      "/api/tables/table-1/leave",
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(onTableChanged).not.toHaveBeenCalled();
    expect(onSeatRemoved).toHaveBeenCalledWith("table-1", "user-1", "left");
  });

  it("kicking passes the host and target through and evicts the target", async () => {
    const runtime = makeRuntime({
      kickTablePlayer: vi.fn().mockResolvedValue(seatChange()),
    });
    const onTableChanged = vi.fn();
    const onSeatRemoved = vi.fn();

    const res = await makeApp(runtime, onTableChanged, onSeatRemoved).request(
      "/api/tables/table-1/kick",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-2" }),
        headers: { "content-type": "application/json" },
      },
    );

    expect(res.status).toBe(200);
    expect(runtime.kickTablePlayer).toHaveBeenCalledWith({
      hostUserId: "user-1",
      tableId: "table-1",
      targetUserId: "user-2",
    });
    expect(onTableChanged).toHaveBeenCalledWith("table-1");
    expect(onSeatRemoved).toHaveBeenCalledWith("table-1", "user-2", "kicked");
  });

  it("kicking requires a target user", async () => {
    const runtime = makeRuntime();

    const res = await makeApp(runtime).request("/api/tables/table-1/kick", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "invalid_request" });
    expect(runtime.kickTablePlayer).not.toHaveBeenCalled();
  });

  it("a refused leave evicts nobody", async () => {
    const runtime = makeRuntime({
      leaveTable: vi
        .fn()
        .mockRejectedValue(new TablesError("game_in_progress", "game_in_progress", 409)),
    });
    const onSeatRemoved = vi.fn();

    const res = await makeApp(runtime, vi.fn(), onSeatRemoved).request(
      "/api/tables/table-1/leave",
      { method: "POST" },
    );

    expect(res.status).toBe(409);
    expect(onSeatRemoved).not.toHaveBeenCalled();
  });

  it("refuses a kick from someone who is not the host, and evicts nobody", async () => {
    const runtime = makeRuntime({
      kickTablePlayer: vi.fn().mockRejectedValue(new TablesError("not_host", "not_host", 403)),
    });
    const onTableChanged = vi.fn();
    const onSeatRemoved = vi.fn();

    const res = await makeApp(runtime, onTableChanged, onSeatRemoved).request(
      "/api/tables/table-1/kick",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-2" }),
        headers: { "content-type": "application/json" },
      },
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "not_host" });
    expect(onTableChanged).not.toHaveBeenCalled();
    expect(onSeatRemoved).not.toHaveBeenCalled();
  });

  it("pushes exactly once for every seat mutation", async () => {
    const runtime = makeRuntime({
      kickTablePlayer: vi.fn().mockResolvedValue(seatChange()),
      leaveTable: vi.fn().mockResolvedValue(seatChange()),
      rematchTable: vi.fn().mockResolvedValue({ tableId: "table-1", gameRowId: "game-2" }),
      startTable: vi.fn().mockResolvedValue({ tableId: "table-1", gameRowId: "game-1" }),
    });
    const onTableChanged = vi.fn();
    const app = makeApp(runtime, onTableChanged);

    const post = (path: string, body?: string) =>
      app.request(path, {
        method: "POST",
        ...(body ? { body, headers: { "content-type": "application/json" } } : {}),
      });

    await post("/api/tables/table-1/start");
    await post("/api/tables/table-1/rematch");
    await post("/api/tables/table-1/leave");
    await post("/api/tables/table-1/kick", JSON.stringify({ userId: "user-2" }));

    expect(onTableChanged).toHaveBeenCalledTimes(4);
    for (const call of onTableChanged.mock.calls) {
      expect(call).toEqual(["table-1"]);
    }
  });
});

describe("tables http api verification gate", () => {
  it("lets an unverified player create and join while verification is optional", async () => {
    const runtime = makeRuntime({
      createTable: vi.fn().mockResolvedValue({ code: "ABC123", tableId: "table-1" }),
      joinTable: vi.fn().mockResolvedValue({ tableId: "table-1" }),
    });
    const app = makeApp(runtime);

    const created = await app.request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ gameId: "yatzy" }),
      headers: { "content-type": "application/json" },
    });
    const joined = await app.request("/api/tables/join", {
      method: "POST",
      body: JSON.stringify({ code: "ABC123" }),
      headers: { "content-type": "application/json" },
    });

    expect(created.status).toBe(201);
    expect(joined.status).toBe(200);
  });

  it("refuses an unverified address when verification is required, without touching the table", async () => {
    const createTable = vi.fn();
    const joinTable = vi.fn();
    const app = makeApp(makeRuntime({ createTable, joinTable }), undefined, undefined, {
      requireVerification: true,
    });

    const created = await app.request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ gameId: "yatzy" }),
      headers: { "content-type": "application/json" },
    });
    const joined = await app.request("/api/tables/join", {
      method: "POST",
      body: JSON.stringify({ code: "ABC123" }),
      headers: { "content-type": "application/json" },
    });

    expect(created.status).toBe(403);
    await expect(created.json()).resolves.toMatchObject({ code: "needs_verify" });
    expect(joined.status).toBe(403);
    await expect(joined.json()).resolves.toMatchObject({ code: "needs_verify" });
    expect(createTable).not.toHaveBeenCalled();
    expect(joinTable).not.toHaveBeenCalled();
  });

  it("lets a verified address through the same gate", async () => {
    const app = makeApp(
      makeRuntime({ createTable: vi.fn().mockResolvedValue({ code: "ABC123", tableId: "t" }) }),
      undefined,
      undefined,
      { emailVerified: true, requireVerification: true },
    );

    const created = await app.request("/api/tables", {
      method: "POST",
      body: JSON.stringify({ gameId: "yatzy" }),
      headers: { "content-type": "application/json" },
    });

    expect(created.status).toBe(201);
  });
});
