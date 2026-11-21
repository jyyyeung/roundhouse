import type { EventEnvelope } from "@roundhouse/game-core";

import type { DuelCard, DuelPlay, DuelRound, DuelState } from "./reduce";

/**
 * The event fields a replay may read. `applyEvent` is pure: everything it needs
 * has to be in the event, which is why the reveal carries both cards and the
 * scores, and the tie-break carries its draw.
 */
type ReplayEvent = Pick<EventEnvelope, "actorId" | "payload" | "type">;

function payloadOf(event: ReplayEvent): Record<string, unknown> {
  const payload = event.payload;
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function isCard(value: unknown): value is DuelCard {
  return value === "strike" || value === "guard" || value === "feint";
}

function readPlays(value: unknown): DuelPlay[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const plays: DuelPlay[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") return null;
    const { card, playerId } = entry as { card?: unknown; playerId?: unknown };
    if (!isCard(card) || typeof playerId !== "string") return null;
    plays.push({ card, playerId });
  }

  return plays;
}

function readScores(value: unknown): Record<string, number> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;

  const scores: Record<string, number> = {};
  for (const [playerId, score] of Object.entries(value as Record<string, unknown>)) {
    if (typeof score !== "number") return null;
    scores[playerId] = score;
  }

  return scores;
}

/**
 * Folds one recorded event back into state (ADR 0002, invariant I3).
 *
 * `duel_picked` carries no card — the log must not leak a pick to the opponent's
 * socket — so folding it cannot rebuild the pending card. That is a deliberate,
 * documented gap: recovery of a live round reads the game row, not the log.
 * Everything from the reveal onward is fully replayable.
 *
 * Unknown events leave state untouched rather than throwing: a replay must
 * survive a log it did not write.
 */
export function applyDuelEvent(state: unknown, event: ReplayEvent): DuelState {
  const current = structuredClone(state) as DuelState;
  const payload = payloadOf(event);

  switch (event.type) {
    case "duel_round": {
      const plays = readPlays(payload.plays);
      const scores = readScores(payload.scores);
      const round = payload.round;
      const winnerId = payload.winnerId;

      if (!plays || !scores || typeof round !== "number") return current;

      const revealed: DuelRound = {
        plays,
        round,
        winnerId: typeof winnerId === "string" ? winnerId : null,
      };

      return {
        ...current,
        pending: {},
        round: round + 1,
        rounds: [...current.rounds, revealed],
        scores,
      };
    }

    case "duel_decided": {
      const { roll, winnerId } = payload;

      if (typeof roll !== "number" || typeof winnerId !== "string") return current;

      return { ...current, decidedBy: "roll", decisiveRoll: { roll, winnerId } };
    }

    case "game_finished": {
      const { decidedBy, winnerIds } = payload;

      if (!Array.isArray(winnerIds)) return current;

      return {
        ...current,
        decidedBy: decidedBy === "roll" || decidedBy === "rounds" ? decidedBy : current.decidedBy,
        phase: "finished",
        winnerIds: winnerIds.filter((id): id is string => typeof id === "string"),
      };
    }

    default:
      return current;
  }
}

export type { ReplayEvent };
