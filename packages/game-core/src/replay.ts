import { z } from "zod";

import type { Json } from "./module";
import { jsonSchema, tableMetaSchema } from "./wire";

/**
 * A replay is a read-side projection (ADR 0009). The server folds the recorded
 * event log through `applyEvent` and publishes **projected state per step** —
 * never the events themselves, because a hidden-information game keeps
 * unrevealed picks in event payloads, which is exactly what projection exists
 * to withhold.
 *
 * One turn is one step a player would recognise (`describeEvent`) together with
 * the state every viewer was entitled to see at that moment.
 */
export const replayTurnSchema = z.object({
  seq: z.number().int().nonnegative(),
  actorId: z.string().nullable(),
  /** A short verb phrase from the game's `describeEvent`, e.g. "scored Fives for 20". */
  phrase: z.string(),
  view: jsonSchema,
});

export const tableReplaySchema = z.object({
  tableId: z.string().min(1).max(64),
  gameId: z.string().min(1).max(64),
  finishedAt: z.string(),
  meta: tableMetaSchema,
  turns: z.array(replayTurnSchema),
});

export type ReplayTurn = z.infer<typeof replayTurnSchema>;
export type TableReplay = z.infer<typeof tableReplaySchema>;

/** The state a viewer sees at a step; the last turn's view is the final board. */
export type ReplayView = Json;
