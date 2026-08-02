import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TableMeta } from "@yatzy/game-core";
import type { YatzyState } from "@yatzy/game-yatzy";

import { YatzyTable } from "./YatzyTable";

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

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

  it("gives the desktop score-sheet panel a definite height for in-panel scrolling", () => {
    const { container } = render(<YatzyTable {...defaultProps} />);
    const board = container.querySelector(".yatzy-board");
    const scoreSheetPanel = board?.children.item(1) as HTMLElement | null;

    expect(scoreSheetPanel?.className).toMatch(/min-h-0/);
    expect(scoreSheetPanel?.className).toMatch(/min-w-0/);
    expect(scoreSheetPanel?.className).toMatch(/md:sticky/);
    expect(scoreSheetPanel?.className).toMatch(/md:h-\[calc\(100dvh-6rem\)\]/);
  });
});

describe("YatzyTable chat layout", () => {
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

  beforeEach(() => {
    mockMatchMedia(false);
  });

  it("hides banner Chat at xl via class", () => {
    render(<YatzyTable {...defaultProps} />);
    const chatButton = screen.getByRole("button", { name: /^chat$/i });
    expect(chatButton.className).toMatch(/xl:hidden/);
  });

  it("shows floating composer when overlay closed", () => {
    render(<YatzyTable {...defaultProps} />);
    expect(screen.getByTestId("chat-float-composer")).toBeInTheDocument();
    expect(screen.getByTestId("chat-float-composer").className).toMatch(/md:hidden/);
  });

  it("hides floating composer when overlay is open", async () => {
    const user = userEvent.setup();
    render(<YatzyTable {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /^chat$/i }));
    expect(screen.queryByTestId("chat-float-composer")).not.toBeInTheDocument();
  });

  it("docks chat beside the board at xl and skips the float", () => {
    mockMatchMedia(true);
    const { container } = render(<YatzyTable {...defaultProps} />);
    const shell = container.querySelector(".yatzy-chat-shell");
    expect(shell?.className).toMatch(/xl:grid/);
    expect(shell?.className).toMatch(/xl:grid-cols-\[minmax\(0,1fr\)_minmax\(18rem,22rem\)\]/);
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-float-composer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close chat/i })).not.toBeInTheDocument();
  });

  it("shares draft between float and overlay composer", async () => {
    const user = userEvent.setup();
    render(<YatzyTable {...defaultProps} />);
    const floatInput = screen.getByTestId("chat-float-composer").querySelector("input");
    expect(floatInput).toBeTruthy();
    await user.type(floatInput!, "banter");
    await user.click(screen.getByRole("button", { name: /^chat$/i }));
    expect(screen.getByRole("textbox", { name: /message/i })).toHaveValue("banter");
  });
});
