import type { TableMeta } from "@roundhouse/game-core";
import type { DuelView } from "@roundhouse/game-duel";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DuelTable } from "./DuelTable";

function baseMeta(overrides: Partial<TableMeta> = {}): TableMeta {
  return {
    code: "DUEL01",
    gameId: "duel",
    config: { rounds: 3 },
    status: "active",
    hostUserId: "user-a",
    seatUserIds: ["user-a", "user-b"],
    softSeatCap: 2,
    ...overrides,
  };
}

function baseState(overrides: Partial<DuelView> = {}): DuelView {
  return {
    gameId: "duel",
    phase: "choosing",
    round: 1,
    totalRounds: 3,
    playerIds: ["user-a", "user-b"],
    you: 0,
    yourPick: null,
    pickedBy: [],
    rounds: [],
    scores: { "user-a": 0, "user-b": 0 },
    winnerIds: [],
    decidedBy: null,
    ...overrides,
  };
}

function renderTable(state: DuelView, meta: TableMeta = baseMeta()) {
  const onIntent = vi.fn();
  render(
    <DuelTable
      meta={meta}
      state={state}
      currentUserId="user-a"
      onlineUserIds={["user-a", "user-b"]}
      onIntent={onIntent}
    />,
  );
  return { onIntent };
}

describe("DuelTable", () => {
  it("offers the three cards and sends a pick as an intent", async () => {
    const { onIntent } = renderTable(baseState());

    expect(screen.getByText("Round 1 of 3")).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Strike"),
      expect.stringContaining("Guard"),
      expect.stringContaining("Feint"),
    ]);

    await userEvent.click(screen.getByRole("button", { name: /^Guard/ }));

    expect(onIntent).toHaveBeenCalledExactlyOnceWith("play", { card: "guard" });
  });

  it("shows your own card, then waits for the opponent", () => {
    renderTable(baseState({ pickedBy: ["user-a"], yourPick: "strike" }));

    expect(screen.getByText(/You played Strike/)).toBeTruthy();
    expect(screen.getByText(/Waiting for Player 2/)).toBeTruthy();
    for (const button of screen.getAllByRole("button")) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });

  it("treats a spectator as unable to pick or to see anyone's card", () => {
    renderTable(baseState({ pickedBy: ["user-a"], you: null, yourPick: null }));

    expect(screen.getByText(/You are watching this duel/)).toBeTruthy();
    expect(screen.queryByText(/You played/)).toBeNull();
    for (const button of screen.getAllByRole("button")) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });

  it("reports public tempo without the card: who has picked, not what", () => {
    renderTable(baseState({ pickedBy: ["user-a"] }));

    // The opponent's row says "thinking"; nothing anywhere says which card is
    // pending, because the projection never carried it.
    expect(screen.getByText("thinking")).toBeTruthy();
    expect(screen.getByText("picked")).toBeTruthy();
    expect(screen.queryByText(/You played/)).toBeNull();
  });

  it("lists revealed rounds and names the winner", () => {
    renderTable(
      baseState({
        phase: "finished",
        round: 3,
        pickedBy: [],
        rounds: [
          {
            round: 1,
            plays: [
              { card: "strike", playerId: "user-a" },
              { card: "feint", playerId: "user-b" },
            ],
            winnerId: "user-a",
          },
          {
            round: 2,
            plays: [
              { card: "guard", playerId: "user-a" },
              { card: "guard", playerId: "user-b" },
            ],
            winnerId: null,
          },
        ],
        scores: { "user-a": 1, "user-b": 0 },
        winnerIds: ["user-a"],
        decidedBy: "rounds",
      }),
    );

    expect(screen.getByText("You wins")).toBeTruthy();
    expect(screen.getByText("Clash — no point")).toBeTruthy();
    expect(screen.getByText("Final scores.")).toBeTruthy();
    expect(screen.getByText(/Final: You 1 — Player 2 0/)).toBeTruthy();
  });

  it("explains a level match broken by the server's draw", () => {
    renderTable(
      baseState({
        phase: "finished",
        scores: { "user-a": 1, "user-b": 1 },
        winnerIds: ["user-b"],
        decidedBy: "roll",
      }),
    );

    expect(screen.getByText("Player 2 wins")).toBeTruthy();
    expect(screen.getByText(/the server drew a card for each of you/)).toBeTruthy();
  });
});
