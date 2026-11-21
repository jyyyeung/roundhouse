import { gameCatalogueSchema } from "@roundhouse/game-core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { getGameCatalogue } from "../modules/registry";
import { createGamesRouter } from "./games";

function makeApp() {
  const app = new Hono();
  app.route("/api/games", createGamesRouter());
  return app;
}

describe("games http api", () => {
  it("lists every registered module and validates against the shared wire schema", async () => {
    const res = await makeApp().request("/api/games");

    expect(res.status).toBe(200);
    const body = await res.json();
    // The schema lives in game-core (ADR 0001), so the client and the server
    // parse the same declaration instead of two hand-written shapes.
    const parsed = gameCatalogueSchema.safeParse(body.games);
    expect(parsed.success).toBe(true);
    expect(body.games).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          defaultConfig: { ruleset: "yatzy" },
          displayName: "Yatzy",
          id: "yatzy",
          playerCount: { max: 6, min: 2 },
        }),
      ]),
    );
  });

  it("is stable and sorted, so the lobby does not reshuffle between loads", async () => {
    const first = await makeApp().request("/api/games");
    const second = await makeApp().request("/api/games");

    const ids = (await first.json()).games.map((game: { id: string }) => game.id);
    expect(ids).toEqual((await second.json()).games.map((game: { id: string }) => game.id));
    expect(ids).toEqual([...ids].sort());
  });

  it("publishes no schema or module internals", () => {
    // `configSchema` is a zod type, not JSON; anything non-serialisable here
    // would be silently dropped by `c.json` rather than caught.
    for (const entry of getGameCatalogue()) {
      expect(Object.keys(entry).sort()).toEqual([
        "defaultConfig",
        "displayName",
        "id",
        "playerCount",
      ]);
      expect(() => JSON.stringify(entry)).not.toThrow();
    }
  });
});
