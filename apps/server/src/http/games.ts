import { Hono } from "hono";
import { getGameCatalogue } from "../modules/registry";

/**
 * The public game list. Unauthenticated on purpose: the lobby has to know what
 * it can offer before anyone signs in, and none of these fields are secret.
 */
export function createGamesRouter() {
  const app = new Hono();

  app.get("/", (c) => c.json({ games: getGameCatalogue() }));

  return app;
}
