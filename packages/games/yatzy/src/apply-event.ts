import type { EventEnvelope } from "@roundhouse/game-core";

import { applyBonus, cloneState, createSheet, resetTurn, type YatzyState } from "./reduce";

/**
 * The event fields a replay may read. `applyEvent` is pure, so everything it
 * needs has to be in the event itself: no clock, no randomness, no lookups.
 */
type ReplayEvent = Pick<EventEnvelope, "actorId" | "payload" | "type">;

function payloadOf(event: ReplayEvent): Record<string, unknown> {
  const payload = event.payload;
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function isDice(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.length === 5 && value.every((die) => typeof die === "number")
  );
}

function isHolds(value: unknown): value is boolean[] {
  return (
    Array.isArray(value) && value.length === 5 && value.every((hold) => typeof hold === "boolean")
  );
}

/**
 * Folds one recorded event back into state. Together with `reduce`, this is what
 * makes the event log a replay source (ADR 0002, invariant I3): for any intent
 * sequence, `reduce(S, I).events.reduce(applyEvent, S)` deep-equals
 * `reduce(S, I).state`.
 *
 * Events the module does not recognise leave state untouched instead of
 * throwing. Replay must survive a log it did not write — most importantly
 * `chat_sent` rows persisted before M0-3, when chat still bumped the game seq.
 */
export function applyYatzyEvent(state: unknown, event: ReplayEvent): YatzyState {
  const current = cloneState(state as YatzyState);
  const payload = payloadOf(event);

  switch (event.type) {
    case "dice_rolled": {
      const { dice, rollsLeft } = payload;

      if (!isDice(dice) || typeof rollsLeft !== "number") return current;

      return { ...current, dice: [...dice], rollsLeft };
    }

    case "dice_held": {
      const { holds } = payload;

      if (!isHolds(holds)) return current;

      return { ...current, holds: [...holds] };
    }

    case "category_scored": {
      const { category, score } = payload;

      if (typeof category !== "string" || typeof score !== "number") return current;
      if (!event.actorId || !current.playerIds.includes(event.actorId)) return current;

      const sheet = current.sheets[event.actorId] ?? createSheet(current.ruleset);

      if (!(category in sheet) || category === "bonus") return current;

      return {
        ...current,
        sheets: {
          ...current.sheets,
          [event.actorId]: applyBonus({ ...sheet, [category]: score }),
        },
      };
    }

    case "turn_advanced": {
      const { currentPlayerId } = payload;
      const index =
        typeof currentPlayerId === "string" ? current.playerIds.indexOf(currentPlayerId) : -1;

      if (index < 0) return current;

      return resetTurn(current, index);
    }

    case "game_finished": {
      const { winnerIds } = payload;

      if (!Array.isArray(winnerIds)) return current;

      return {
        ...current,
        phase: "finished",
        winnerIds: winnerIds.filter((id): id is string => typeof id === "string"),
      };
    }

    default:
      return current;
  }
}

export type { ReplayEvent };
