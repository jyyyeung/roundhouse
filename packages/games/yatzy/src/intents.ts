import { jsonSchema } from "@roundhouse/game-core";
import { z } from "zod";

/**
 * The intents this module accepts, and the payload each one requires. The server
 * rejects everything else before `reduce` runs (`unknown_intent` /
 * `invalid_payload`), so these schemas are the module's public input contract.
 *
 * They are deliberately structural: whether a category exists, whether it is the
 * player's turn, and what the dice say all belong to `reduce`, which can answer
 * with a specific game error instead of a generic parse failure.
 */
export const yatzyIntents: Readonly<Record<string, z.ZodType>> = {
  /** Rolling takes no input; reduce reads only the dice and `rollsLeft`. */
  roll: jsonSchema,
  set_holds: z.object({ holds: z.array(z.boolean()).length(5) }),
  score: z.object({ category: z.string().min(1) }),
};
