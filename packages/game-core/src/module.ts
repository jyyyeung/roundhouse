import type { z } from "zod";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type EventEnvelope = {
  id: string;
  tableId: string;
  gameId: string;
  seq: number;
  type: string;
  actorId: string | null;
  payload: Json;
  createdAt: string; // ISO
};

export type ReduceResult =
  | { ok: true; state: Json; events: Omit<EventEnvelope, "id" | "seq" | "createdAt">[] }
  | { ok: false; error: string };

export type ReduceContext = {
  actorId: string;
  randomInt: (maxExclusive: number) => number; // 0..maxExclusive-1
  now: () => Date;
  playerIds: string[];
};

/**
 * Who is looking at a table. Every state that crosses the wire is projected for
 * exactly one viewer, so a module never has to decide what "public" means.
 */
export type ViewerView =
  | { kind: "player"; userId: string; seatIndex: number }
  | { kind: "spectator"; userId: string | null };

declare const rawGameStateBrand: unique symbol;

/**
 * Unprojected module state as stored server-side. Branded so it is not
 * assignable to `Json`: raw state may only reach a client by passing through
 * `projectStateFor` (see `apps/server/src/room/projection.ts`).
 */
export type RawGameState = { readonly [rawGameStateBrand]: true };

/**
 * The seat range a module can actually run with. Declared by the module rather
 * than by the table, because it is game knowledge: yatzy has no rules for one
 * player, and a duel has none for three.
 */
export type PlayerCount = { min: number; max: number };
export interface GameModule {
  id: string;
  displayName: string;
  /**
   * Valid seat counts. Every table for this game is created inside this range,
   * and the server refuses to start a game outside it, so a module never has to
   * defend against a player count its rules cannot express.
   */
  playerCount: PlayerCount;
  /**
   * The config a table gets when the caller supplies none, and the value the game
   * catalogue advertises. Must satisfy `configSchema`.
   */
  defaultConfig: Json;
  /**
   * Validates (and normalises) the per-table config blob. The server parses every
   * `POST /api/tables` config through this before the row is written.
   */
  configSchema: z.ZodType;
  /**
   * Every intent the module accepts, keyed by `intent.type`, with the schema its
   * payload must satisfy. The server rejects anything absent from this map before
   * `reduce` runs, so a seated client cannot reach module code with an intent (or
   * a payload shape) the module never declared.
   */
  intents: Readonly<Record<string, z.ZodType>>;
  createInitialState(config: Json, playerIds: string[]): Json;
  reduce(state: Json, intent: { type: string; payload: Json }, ctx: ReduceContext): ReduceResult;
  /**
   * Folds one recorded event back into raw state. Pure by contract: no
   * randomness, no clock, no lookups — everything a replay needs is in the event
   * itself. `reduce` and `applyEvent` are the two halves of the replay source
   * (ADR 0002): `reduce(S, I).events.reduce(applyEvent, S)` equals
   * `reduce(S, I).state`. No I/O code may call this; only replay does.
   */
  applyEvent(state: Json, event: EventEnvelope): Json;
  /**
   * One short verb phrase for a recorded event, used by replay to label a step
   * ("scored Fives for 20"). Return `null` for events that are bookkeeping
   * rather than something a player did, so every scrubber step is an action.
   * Optional: a module without it labels steps with its humanised event type.
   */
  describeEvent?(event: EventEnvelope): string | null;
  /**
   * The only way module state becomes client-visible: returns exactly what
   * `viewer` is allowed to see, never the raw state.
   */
  projectStateFor(state: RawGameState, viewer: ViewerView): Json;
  isFinished(state: Json): boolean;
}
