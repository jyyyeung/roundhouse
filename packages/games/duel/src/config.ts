import type { Json } from "@roundhouse/game-core";
import { z } from "zod";

/**
 * Duel's config is deliberately tiny: how many rounds a match lasts. It exists
 * so the lobby's create form, the catalogue and `createInitialState` share one
 * described shape, not because the game needs knobs.
 */
export const duelConfigSchema = z.object({
  rounds: z.number().int().min(1).max(9).default(3),
});

export type DuelConfig = z.infer<typeof duelConfigSchema>;

export const defaultDuelConfig: Json = { rounds: 3 };

/**
 * A duel is two seats. Both players need a second opinion to be a duel, and a
 * third would turn a simultaneous two-player reveal into a different game.
 */
export const duelPlayerCount = { min: 2, max: 2 };
