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

export interface GameModule {
  id: string;
  displayName: string;
  createInitialState(config: Json, playerIds: string[]): Json;
  reduce(state: Json, intent: { type: string; payload: Json }, ctx: ReduceContext): ReduceResult;
  getPublicSnapshot(state: Json): Json;
  isFinished(state: Json): boolean;
}

