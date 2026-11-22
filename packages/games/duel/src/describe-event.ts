import type { EventEnvelope } from "@roundhouse/game-core";

/** The event fields a label may read. */
type DescribedEvent = Pick<EventEnvelope, "payload" | "type">;

function payloadOf(event: DescribedEvent): Record<string, unknown> {
  const payload = event.payload;
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/**
 * One verb phrase per recorded action, for replay (ADR 0009).
 *
 * `duel_picked` returns `null` on purpose. The log records *that* a seat chose,
 * never *what* it chose (see `reduce.ts` and ADR 0005), so a step taken between
 * two picks would show a round whose pending card the fold cannot rebuild. A
 * replay shows the rounds as they were revealed instead of pretending to know
 * more than the log does.
 */
export function describeDuelEvent(event: DescribedEvent): string | null {
  const payload = payloadOf(event);

  switch (event.type) {
    case "duel_round": {
      const round = payload.round;
      return typeof round === "number" ? `resolved round ${round}` : "resolved a round";
    }

    case "duel_decided":
      return "settled the tie-break";

    case "game_finished":
      return "finished the match";

    default:
      return null;
  }
}
