import { describe, expect, it } from "vitest";

import {
  type GameSummary,
  playerLabel,
  rankStandings,
  summaryText,
  summaryTextLines,
  winnerHeadline,
} from "./summary";

const labels = { "user-a": "You", "user-b": "Player 2" };

function summary(overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    lines: [{ label: "Best category", value: "Fives — 20" }],
    rounds: 14,
    standings: [
      { playerId: "user-a", total: 187 },
      { playerId: "user-b", total: 214 },
    ],
    winners: ["user-b"],
    ...overrides,
  };
}

describe("summary card data", () => {
  it("ranks the standings highest total first and leaves the input alone", () => {
    const input = summary().standings;
    const ranked = rankStandings(input);

    expect(ranked.map((standing) => standing.playerId)).toEqual(["user-b", "user-a"]);
    expect(input.map((standing) => standing.playerId)).toEqual(["user-a", "user-b"]);
  });

  it("keeps the game's own order when two totals are level", () => {
    const ranked = rankStandings([
      { playerId: "user-a", total: 200 },
      { playerId: "user-b", total: 200 },
    ]);

    expect(ranked.map((standing) => standing.playerId)).toEqual(["user-a", "user-b"]);
  });

  it("names one winner, a draw, or a tie depending on who won", () => {
    expect(winnerHeadline(summary(), labels)).toBe("Player 2 wins");
    expect(winnerHeadline(summary({ winners: [] }), labels)).toBe("A draw");
    expect(winnerHeadline(summary({ winners: ["user-a", "user-b"] }), labels)).toBe(
      "You and Player 2 tie",
    );
  });

  it("falls back to the raw id when a player has no label", () => {
    expect(playerLabel({}, "user-z")).toBe("user-z");
  });

  it("lays the card out as text: title, winner, ranking, rounds, extra lines", () => {
    expect(summaryText({ labels, summary: summary(), title: "Riverside Yatzy" })).toBe(
      [
        "Riverside Yatzy — final scores",
        "Player 2 wins",
        "1. Player 2 — 214",
        "2. You — 187",
        "14 rounds",
        "Best category: Fives — 20",
      ].join("\n"),
    );
  });

  it("omits the parts a game did not give it", () => {
    expect(
      summaryTextLines({
        labels,
        summary: { standings: [], winners: [], lines: undefined, rounds: undefined },
        title: "Duel",
      }),
    ).toEqual(["Duel — final scores", "A draw"]);
  });
});
