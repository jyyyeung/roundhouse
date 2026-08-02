import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TableMeta } from "@yatzy/game-core";
import type { YatzyState } from "@yatzy/game-yatzy";

import { YatzyTable } from "./YatzyTable";

function baseMeta(overrides: Partial<TableMeta> = {}): TableMeta {
  return {
    code: "Z2YLBJ",
    gameId: "yatzy",
    config: { ruleset: "yatzy" },
    status: "active",
    hostUserId: "user-a",
    seatUserIds: ["user-a", "user-b"],
    softSeatCap: 4,
    ...overrides,
  };
}

function baseState(overrides: Partial<YatzyState> = {}): YatzyState {
  return {
    ruleset: "yatzy",
    playerIds: ["user-a", "user-b"],
    currentPlayerIndex: 0,
    rollsLeft: 2,
    dice: [1, 2, 3, 4, 5],
    holds: [false, false, false, false, false],
    sheets: {
      "user-a": {
        ones: null,
        twos: null,
        threes: null,
        fours: null,
        fives: null,
        sixes: null,
        one_pair: null,
        two_pairs: null,
        three_kind: null,
        four_kind: null,
        small_straight: null,
        large_straight: null,
        full_house: null,
        chance: null,
        yatzy: null,
        bonus: null,
      },
      "user-b": {
        ones: null,
        twos: null,
        threes: null,
        fours: null,
        fives: null,
        sixes: null,
        one_pair: null,
        two_pairs: null,
        three_kind: null,
        four_kind: null,
        small_straight: null,
        large_straight: null,
        full_house: null,
        chance: null,
        yatzy: null,
        bonus: null,
      },
    },
    phase: "playing",
    winnerIds: [],
    ...overrides,
  };
}

describe("YatzyTable", () => {
  const defaultProps = {
    meta: baseMeta(),
    state: baseState(),
    currentUserId: "user-a",
    onlineUserIds: ["user-a", "user-b"],
    messages: [],
    onIntent: vi.fn(),
    onSendChat: vi.fn(),
    rollVersion: 0,
  };

  it("uses a two-column playboard grid on md+", () => {
    const { container } = render(<YatzyTable {...defaultProps} />);
    const board = container.querySelector(".yatzy-board");
    expect(board?.className).toMatch(/md:grid/);
    expect(board?.className).toMatch(/md:grid-cols-\[minmax\(0,0\.42fr\)_minmax\(0,0\.58fr\)\]/);
  });

  it("hides standings below md and keeps a slim strip class for desktop", () => {
    render(<YatzyTable {...defaultProps} />);
    const standings = screen.getByTestId("standings");
    expect(standings.className).toMatch(/hidden/);
    expect(standings.className).toMatch(/md:block/);
    expect(screen.queryByText(/live totals update/i)).not.toBeInTheDocument();
  });

  it("starts with a collapsed mobile status strip and expands on toggle", async () => {
    const user = userEvent.setup();
    render(<YatzyTable {...defaultProps} />);
    const details = screen.getByTestId("status-details");

    expect(details.className).toBe("hidden md:block");
    expect(within(details).getByText(/your turn\. roll, hold/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /expand status/i }));
    expect(details.className).toBe("block md:block");

    await user.click(screen.getByRole("button", { name: /collapse status/i }));
    expect(details.className).toBe("hidden md:block");
  });

  it("keeps desktop status details visible without requiring expand", () => {
    render(<YatzyTable {...defaultProps} />);
    const details = screen.getByTestId("status-details");
    expect(details.className).toMatch(/md:block/);
    expect(within(details).getByText(/your turn\. roll, hold/i)).toBeInTheDocument();
  });
});
