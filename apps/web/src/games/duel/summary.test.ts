import type { DuelView } from "@roundhouse/game-duel";
import { describe, expect, it } from "vitest";

import { summarizeDuel } from "./summary";

function finishedView(overrides: Partial<DuelView> = {}): DuelView {
  return {
    decidedBy: "rounds",
    gameId: "duel",
    phase: "finished",
    pickedBy: [],
    playerIds: ["user-a", "user-b"],
    round: 4,
    rounds: [
      { plays: [], round: 1, winnerId: "user-b" },
      { plays: [], round: 2, winnerId: "user-b" },
      { plays: [], round: 3, winnerId: "user-a" },
    ],
    scores: { "user-a": 1, "user-b": 2 },
    totalRounds: 3,
    winnerIds: ["user-b"],
    you: 0,
    yourPick: null,
    ...overrides,
  } as DuelView;
}

describe("summarizeDuel", () => {
  it("says nothing while the match is still open", () => {
    expect(summarizeDuel(finishedView({ phase: "choosing" }))).toBeNull();
  });

  it("reports the final scores in seat order and counts the rounds played", () => {
    const summary = summarizeDuel(finishedView());

    expect(summary?.winners).toEqual(["user-b"]);
    // Ranking is the card's job (`rankStandings`), so the data keeps seat order:
    // two viewers must read the same summary.
    expect(summary?.standings).toEqual([
      { playerId: "user-a", total: 1 },
      { playerId: "user-b", total: 2 },
    ]);
    expect(summary?.rounds).toBe(3);
  });

  it("names the longest run of wins nobody interrupted", () => {
    expect(summarizeDuel(finishedView())?.lines).toEqual([
      { label: "Longest streak", value: "2 rounds" },
    ]);
  });

  it("treats a drawn round as breaking a streak", () => {
    const view = finishedView({
      rounds: [
        { plays: [], round: 1, winnerId: "user-b" },
        { plays: [], round: 2, winnerId: "user-b" },
        { plays: [], round: 3, winnerId: null },
        { plays: [], round: 4, winnerId: "user-b" },
        { plays: [], round: 5, winnerId: "user-b" },
      ],
      scores: { "user-a": 0, "user-b": 4 },
    });

    // Without the draw this would read as one run of four.
    expect(summarizeDuel(view)?.lines).toEqual([{ label: "Longest streak", value: "2 rounds" }]);
  });

  it("explains a match that a final roll settled", () => {
    const view = finishedView({ decidedBy: "roll" });

    expect(summarizeDuel(view)?.lines).toEqual([
      { label: "Longest streak", value: "2 rounds" },
      { label: "Decided by", value: "a final roll" },
    ]);
  });

  it("omits the streak line when the match was entirely draws", () => {
    const view = finishedView({
      rounds: [
        { plays: [], round: 1, winnerId: null },
        { plays: [], round: 2, winnerId: null },
        { plays: [], round: 3, winnerId: null },
      ],
      scores: { "user-a": 0, "user-b": 0 },
      winnerIds: [],
    });

    expect(summarizeDuel(view)?.lines).toEqual([]);
    expect(summarizeDuel(view)?.winners).toEqual([]);
  });
});
