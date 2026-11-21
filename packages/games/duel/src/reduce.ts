import type { EventEnvelope, Json, ReduceContext, ReduceResult } from "@roundhouse/game-core";

import { duelConfigSchema } from "./config";

/**
 * The three cards. Each beats exactly one of the others, so the round is a
 * closed triangle with one non-transitive relation and no hidden modifier: the
 * only thing a player cannot see is what their opponent is about to play.
 */
export const DUEL_CARDS = ["strike", "guard", "feint"] as const;

export type DuelCard = (typeof DUEL_CARDS)[number];

/** What each card defeats. */
const BEATS: Record<DuelCard, DuelCard> = {
  feint: "guard",
  guard: "strike",
  strike: "feint",
};

/** One player's revealed card, tagged with the seat that played it. */
export type DuelPlay = { card: DuelCard; playerId: string };

/** A resolved round. `winnerId` is null when both played the same card. */
export type DuelRound = { plays: DuelPlay[]; round: number; winnerId: string | null };

/**
 * The authoritative state. `pending` is the whole reason this game exists: it
 * holds a card the opponent's projection must never contain (ADR 0001).
 */
export type DuelState = {
  tableId: string;
  gameId: "duel";
  playerIds: string[];
  round: number;
  totalRounds: number;
  pending: Record<string, DuelCard>;
  rounds: DuelRound[];
  scores: Record<string, number>;
  phase: "choosing" | "finished";
  winnerIds: string[];
  /** `rounds` when the scores were enough, `roll` when the server had to break a level match. */
  decidedBy: "rounds" | "roll" | null;
  /** The tie-break draw, kept so `applyEvent` does not have to re-roll it. */
  decisiveRoll: { roll: number; winnerId: string } | null;
};

const DEFAULT_ROUNDS = 3;

type Event = Omit<EventEnvelope, "createdAt" | "id" | "seq">;

function success(state: DuelState, events: Event[]): ReduceResult {
  return { events, ok: true, state };
}

function fail(error: string): ReduceResult {
  return { error, ok: false };
}

export function createDuelState(config: Json, playerIds: string[]): DuelState {
  const raw = (config ?? {}) as { rounds?: unknown; tableId?: unknown };
  const parsed = duelConfigSchema.safeParse({ rounds: raw.rounds });
  const totalRounds = parsed.success ? parsed.data.rounds : DEFAULT_ROUNDS;

  return {
    tableId: typeof raw.tableId === "string" ? raw.tableId : "duel",
    gameId: "duel",
    playerIds: [...playerIds],
    round: 1,
    totalRounds,
    pending: {},
    rounds: [],
    scores: Object.fromEntries(playerIds.map((playerId) => [playerId, 0])),
    phase: "choosing",
    winnerIds: [],
    decidedBy: null,
    decisiveRoll: null,
  } satisfies DuelState;
}

/**
 * Which seat wins a round: 0, 1, or null for a clash (both played the same card).
 * Exported so the view and the tests read the same rule the reducer uses.
 */
export function roundWinner(first: DuelCard, second: DuelCard): 0 | 1 | null {
  if (first === second) return null;
  return BEATS[first] === second ? 0 : 1;
}

function event(state: DuelState, actorId: string, type: string, payload: Json): Event {
  return { actorId, gameId: state.gameId, payload, tableId: state.tableId, type };
}

/**
 * Resolves a round once both seats have picked: scores, reveal, and — on the
 * last round — the winner.
 *
 * The tie-break is `ctx.randomInt` and its result is written into the event, so
 * a level match is decided once by the server and settles identically on every
 * replay instead of re-rolling (invariant I3).
 */
function resolveRound(current: DuelState, pending: Record<string, DuelCard>, ctx: ReduceContext) {
  const plays: DuelPlay[] = current.playerIds.map((playerId) => ({
    card: pending[playerId] as DuelCard,
    playerId,
  }));
  const [first, second] = plays as [DuelPlay, DuelPlay];
  const winningSeat = roundWinner(first.card, second.card);
  const winnerId = winningSeat === null ? null : (plays[winningSeat]?.playerId ?? null);

  const scores: Record<string, number> = { ...current.scores };
  if (winnerId) scores[winnerId] = (scores[winnerId] ?? 0) + 1;

  const revealed: DuelRound = { plays, round: current.round, winnerId };
  const nextRound = current.round + 1;

  const state: DuelState = {
    ...current,
    pending: {},
    round: nextRound,
    rounds: [...current.rounds, revealed],
    scores,
  };

  const events: Event[] = [
    event(state, ctx.actorId, "duel_round", {
      plays: plays.map((play) => ({ card: play.card, playerId: play.playerId })),
      round: revealed.round,
      scores,
      winnerId,
    }),
  ];

  if (nextRound <= current.totalRounds) return success(state, events);

  const [seatZero, seatOne] = current.playerIds as [string, string];
  let finished: DuelState = { ...state, phase: "finished" };

  if (scores[seatZero] !== scores[seatOne]) {
    const winner = (scores[seatZero] ?? 0) > (scores[seatOne] ?? 0) ? seatZero : seatOne;
    finished = { ...finished, decidedBy: "rounds", winnerIds: [winner] };
  } else {
    const roll = ctx.randomInt(2);
    const winnerId = (current.playerIds[roll] ?? seatZero) as string;
    finished = {
      ...finished,
      decidedBy: "roll",
      decisiveRoll: { roll, winnerId },
      winnerIds: [winnerId],
    };
    events.push(event(finished, ctx.actorId, "duel_decided", { roll, winnerId }));
  }

  events.push(
    event(finished, ctx.actorId, "game_finished", {
      decidedBy: finished.decidedBy,
      winnerIds: finished.winnerIds,
    }),
  );

  return success(finished, events);
}

/**
 * A pick is logged as *that a seat has chosen*, never as *what it chose*.
 *
 * Events are broadcast to both sockets without projection (finding F2), so a
 * card in an event payload would be a card the opponent can read. The card
 * enters the log only with `duel_round`, when it is public anyway. The cost is
 * that folding a log that stops mid-round cannot rebuild the pending card — the
 * game row's state is authoritative for a live round, the log from the reveal
 * onward. See `docs/adding-a-game.md` and ADR 0005.
 */
export function reduce(
  state: Json,
  intent: { type: string; payload: Json },
  ctx: ReduceContext,
): ReduceResult {
  const current = state as unknown as DuelState;

  if (intent.type !== "play") return fail("unknown_intent");
  if (current.phase === "finished") return fail("game_finished");
  if (current.round > current.totalRounds) return fail("game_finished");
  if (!current.playerIds.includes(ctx.actorId)) return fail("not_a_player");

  const card = (intent.payload as { card?: unknown } | null)?.card;
  if (typeof card !== "string" || !DUEL_CARDS.includes(card as DuelCard))
    return fail("invalid_card");
  if (current.pending[ctx.actorId]) return fail("already_played");

  const pending: Record<string, DuelCard> = { ...current.pending, [ctx.actorId]: card as DuelCard };
  const waiting = current.playerIds.filter((playerId) => !pending[playerId]);

  if (waiting.length > 0) {
    return {
      events: [event(current, ctx.actorId, "duel_picked", { playerId: ctx.actorId })],
      ok: true,
      state: { ...current, pending },
    };
  }

  return resolveRound(current, pending, ctx);
}

export type { Event };
