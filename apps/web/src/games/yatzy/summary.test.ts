import type { YatzyView } from "@roundhouse/game-yatzy";
import { describe, expect, it } from "vitest";

import { summarizeYatzy } from "./summary";

const blank = {
  bonus: null,
  chance: null,
  four_kind: null,
  fours: null,
  full_house: null,
  large_straight: null,
  one_pair: null,
  ones: null,
  sixes: null,
  small_straight: null,
  three_kind: null,
  threes: null,
  two_pairs: null,
  twos: null,
  yatzy: null,
} as const;

function finishedView(overrides: Partial<YatzyView> = {}): YatzyView {
  return {
    currentPlayerId: null,
    dice: [0, 0, 0, 0, 0],
    gameId: "yatzy",
    holds: [false, false, false, false, false],
    phase: "finished",
    playerIds: ["user-a", "user-b"],
    rollsLeft: 0,
    ruleset: "yatzy",
    sheets: {
      // 59 upper + 103 lower = 162.
      "user-a": {
        ...blank,
        chance: 22,
        fives: 20,
        four_kind: 0,
        fours: 8,
        full_house: 25,
        large_straight: 0,
        one_pair: 10,
        ones: 3,
        sixes: 18,
        small_straight: 15,
        three_kind: 15,
        threes: 6,
        two_pairs: 16,
        twos: 4,
        yatzy: 0,
      },
      // 22 upper + 70 lower = 92, and the best single cell in the game.
      "user-b": {
        ...blank,
        chance: 20,
        five_kind: null,
        fives: 5,
        fours: 4,
        ones: 2,
        sixes: 6,
        threes: 3,
        twos: 2,
        yatzy: 50,
      } as YatzyView["sheets"][string],
    },
    winnerIds: ["user-a"],
    you: 0,
    ...overrides,
  } as YatzyView;
}

describe("summarizeYatzy", () => {
  it("says nothing while the game is still being played", () => {
    expect(summarizeYatzy(finishedView({ phase: "playing" }))).toBeNull();
  });

  it("ranks the sheets by total and names the game's best category", () => {
    const summary = summarizeYatzy(finishedView());

    expect(summary?.winners).toEqual(["user-a"]);
    expect(summary?.standings).toEqual([
      { playerId: "user-a", total: 162 },
      { playerId: "user-b", total: 92 },
    ]);
    expect(summary?.lines).toEqual([{ label: "Best category", value: "Yatzy — 50" }]);
  });

  it("counts a round as one scored category per player", () => {
    // user-a filled 15 cells, user-b 9: the game lasted 15 rounds.
    expect(summarizeYatzy(finishedView())?.rounds).toBe(15);
  });

  it("mentions the upper-section bonus only when someone earned it", () => {
    const view = finishedView();
    view.sheets["user-a"] = { ...view.sheets["user-a"], bonus: 35 };

    expect(summarizeYatzy(view)?.lines).toEqual([
      { label: "Best category", value: "Yatzy — 50" },
      { label: "Bonus", value: "1 player broke 63" },
    ]);

    view.sheets["user-b"] = { ...view.sheets["user-b"], bonus: 35 };
    expect(summarizeYatzy(view)?.lines?.at(-1)).toEqual({
      label: "Bonus",
      value: "2 players broke 63",
    });
  });

  it("reports an empty board as zero rounds rather than a negative or NaN count", () => {
    const view = finishedView();
    view.sheets = { "user-a": { ...blank }, "user-b": { ...blank } } as YatzyView["sheets"];

    expect(summarizeYatzy(view)?.rounds).toBe(0);
    expect(summarizeYatzy(view)?.lines).toEqual([]);
  });
});
