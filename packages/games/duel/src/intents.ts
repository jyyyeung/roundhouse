import { z } from "zod";

import { DUEL_CARDS } from "./reduce";

/**
 * The intents this module accepts. `play` is the only one: a duel is nothing but
 * two players choosing a card and the round being revealed.
 *
 * The schema is structural on purpose — whether the actor is seated, whether the
 * round is already over, and whether they have already picked all belong to
 * `reduce`, which can answer with a specific game error instead of a parse
 * failure that tells a client nothing.
 */
export const duelIntents: Readonly<Record<string, z.ZodType>> = {
  play: z.object({ card: z.enum(DUEL_CARDS) }),
};
