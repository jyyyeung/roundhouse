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

export interface GameModule {
  id: string;
  displayName: string;
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
   * The only way module state becomes client-visible: returns exactly what
   * `viewer` is allowed to see, never the raw state.
   */
  projectStateFor(state: RawGameState, viewer: ViewerView): Json;
  isFinished(state: Json): boolean;
}

