import type { EventEnvelope } from "@roundhouse/game-core";
import { describe, expect, it } from "vitest";

import { describeYatzyEvent } from "./describe-event";

function event(type: string, payload: EventEnvelope["payload"] = {}) {
  return { payload, type };
}

describe("describeYatzyEvent", () => {
  it("names the dice a roll produced", () => {
    expect(describeYatzyEvent(event("dice_rolled", { dice: [5, 2, 4, 1, 2], rollsLeft: 1 }))).toBe(
      "rolled 5 2 4 1 2",
    );
  });

  it("degrades to a bare verb when the roll payload is missing or malformed", () => {
    expect(describeYatzyEvent(event("dice_rolled"))).toBe("rolled");
    expect(describeYatzyEvent(event("dice_rolled", { dice: ["five"] } as never))).toBe("rolled");
  });

  it("counts the dice held, with singular and empty wording", () => {
    expect(
      describeYatzyEvent(event("dice_held", { holds: [true, true, true, false, false] })),
    ).toBe("held 3 dice");
    expect(
      describeYatzyEvent(event("dice_held", { holds: [true, false, false, false, false] })),
    ).toBe("held 1 die");
    expect(
      describeYatzyEvent(event("dice_held", { holds: [false, false, false, false, false] })),
    ).toBe("held no dice");
    expect(describeYatzyEvent(event("dice_held", { holds: "all" } as never))).toBe("changed holds");
  });

  it("reads a scored category as a sentence", () => {
    expect(
      describeYatzyEvent(event("category_scored", { category: "full_house", score: 25 })),
    ).toBe("scored full house for 25");
    expect(describeYatzyEvent(event("category_scored", { category: "ones" }))).toBe("scored");
  });

  it("describes the end of the game", () => {
    expect(describeYatzyEvent(event("game_finished", { winnerIds: ["p1"] }))).toBe(
      "finished the game",
    );
  });

  it("claims no step for bookkeeping and unknown events", () => {
    expect(describeYatzyEvent(event("turn_advanced", { currentPlayerId: "p2" }))).toBeNull();
    expect(describeYatzyEvent(event("something_new"))).toBeNull();
  });
});
