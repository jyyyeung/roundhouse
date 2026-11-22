import { describe, expect, it } from "vitest";

import { describeDuelEvent } from "./describe-event";

describe("describeDuelEvent", () => {
  it("names the round a reveal resolved", () => {
    expect(describeDuelEvent({ payload: { round: 3 }, type: "duel_round" })).toBe(
      "resolved round 3",
    );
    expect(describeDuelEvent({ payload: {}, type: "duel_round" })).toBe("resolved a round");
  });

  it("describes the tie-break and the end of the match", () => {
    expect(describeDuelEvent({ payload: { roll: [6, 2] }, type: "duel_decided" })).toBe(
      "settled the tie-break",
    );
    expect(describeDuelEvent({ payload: { winnerIds: ["p1"] }, type: "game_finished" })).toBe(
      "finished the match",
    );
  });

  it("claims no step for a pick, because the log never held the card", () => {
    expect(describeDuelEvent({ payload: { playerId: "p1" }, type: "duel_picked" })).toBeNull();
    expect(describeDuelEvent({ payload: {}, type: "unknown_event" })).toBeNull();
  });
});
