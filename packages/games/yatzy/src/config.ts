import type { Json } from "@roundhouse/game-core";
import { z } from "zod";

/**
 * The per-table config yatzy defines. It lives with the game, not with the HTTP
 * layer: `GameModule.configSchema` publishes it, so the server validates a table
 * config without knowing which game it belongs to.
 */
export const yatzyConfigSchema = z.object({
  ruleset: z.enum(["yatzy", "yahtzee"]),
});

export type YatzyConfig = z.infer<typeof yatzyConfigSchema>;

export const defaultYatzyConfig: Json = { ruleset: "yatzy" };

/**
 * A yatzy card holds any number of players, but a table needs at least two to be
 * a game, and the score sheet stops being readable past six seats.
 */
export const yatzyPlayerCount = { min: 2, max: 6 };
