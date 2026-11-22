import type { EventEnvelope } from "@roundhouse/game-core";

/** The event fields a label may read. Labels must not need anything else. */
type DescribedEvent = Pick<EventEnvelope, "payload" | "type">;

function payloadOf(event: DescribedEvent): Record<string, unknown> {
  const payload = event.payload;
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function readDice(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((die) => typeof die === "number")
    ? (value as number[])
    : null;
}

function readHolds(value: unknown): boolean[] | null {
  return Array.isArray(value) && value.every((hold) => typeof hold === "boolean")
    ? (value as boolean[])
    : null;
}

/**
 * One verb phrase per recorded action, for replay (ADR 0009).
 *
 * `turn_advanced` returns `null`: it records a handoff, not something a player
 * did, and a scrubber step nobody recognises is worse than no step. An
 * unrecognised event also returns `null` for the same reason — a log written by
 * an older version may hold events this one cannot describe.
 */
export function describeYatzyEvent(event: DescribedEvent): string | null {
  const payload = payloadOf(event);

  switch (event.type) {
    case "dice_rolled": {
      const dice = readDice(payload.dice);
      return dice ? `rolled ${dice.join(" ")}` : "rolled";
    }

    case "dice_held": {
      const holds = readHolds(payload.holds);
      if (!holds) return "changed holds";
      const held = holds.filter(Boolean).length;
      if (held === 0) return "held no dice";
      return held === 1 ? "held 1 die" : `held ${held} dice`;
    }

    case "category_scored": {
      const { category, score } = payload;
      if (typeof category !== "string" || typeof score !== "number") return "scored";
      // Category ids are snake_case; the phrase reads as a sentence without them.
      return `scored ${category.replace(/_/g, " ")} for ${score}`;
    }

    case "game_finished":
      return "finished the game";

    default:
      return null;
  }
}
