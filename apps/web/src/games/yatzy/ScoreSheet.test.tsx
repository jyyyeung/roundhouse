import { getScoreHelp, type YatzyView } from "@roundhouse/game-yatzy";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScoreSheet } from "./ScoreSheet";

function baseState(overrides: Partial<YatzyView> = {}): YatzyView {
  return {
    gameId: "yatzy",
    ruleset: "yatzy",
    playerIds: ["user-a", "user-b"],
    currentPlayerId: "user-a",
    you: 0,
    rollsLeft: 2,
    dice: [1, 1, 1, 2, 3],
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
        ones: 3,
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

describe("ScoreSheet", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows preview score for clickable open cells and dash otherwise", () => {
    render(
      <ScoreSheet
        state={baseState()}
        playerLabels={{ "user-a": "You", "user-b": "Player 2" }}
        currentUserId="user-a"
        canScore
        onScore={vi.fn()}
      />,
    );

    // Ones with dice [1,1,1,2,3] preview = 3 for current player
    expect(screen.getByRole("button", { name: /score ones/i })).toHaveTextContent("3");
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
    expect(screen.queryByText(/would score/i)).not.toBeInTheDocument();

    // Opponent scored ones = 3; other opponent open cells are dashes
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("shows dash when dice are unrolled even if clickable", () => {
    render(
      <ScoreSheet
        state={baseState({ dice: [0, 0, 0, 0, 0] })}
        playerLabels={{ "user-a": "You", "user-b": "Player 2" }}
        currentUserId="user-a"
        canScore
        onScore={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /score ones/i })).toHaveTextContent("—");
  });

  it("invokes onScore when a preview cell is clicked", async () => {
    const user = userEvent.setup();
    const onScore = vi.fn();

    render(
      <ScoreSheet
        state={baseState()}
        playerLabels={{ "user-a": "You", "user-b": "Player 2" }}
        currentUserId="user-a"
        canScore
        onScore={onScore}
      />,
    );

    await user.click(screen.getByRole("button", { name: /score ones/i }));
    expect(onScore).toHaveBeenCalledWith("ones");
  });

  it("uses dense cell padding and desktop scroll shell", () => {
    const { container } = render(
      <ScoreSheet
        state={baseState()}
        playerLabels={{ "user-a": "You", "user-b": "Player 2" }}
        currentUserId="user-a"
        canScore
        onScore={vi.fn()}
      />,
    );

    const section = container.querySelector("section");
    expect(section?.className).toMatch(/md:min-h-0/);
    expect(section?.className).toMatch(/md:overflow-y-auto/);
    expect(section?.className).toMatch(/md:h-full/);

    const onesButton = screen.getByRole("button", { name: /score ones/i });
    expect(onesButton.className).toMatch(/py-2/);
    expect(onesButton.className).not.toMatch(/py-3/);
  });

  it("exposes help tips for categories and footers", () => {
    render(
      <ScoreSheet
        state={baseState()}
        playerLabels={{ "user-a": "You", "user-b": "Player 2" }}
        currentUserId="user-a"
        canScore
        onScore={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "About Ones" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About Bonus" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About Upper total" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About Total" })).toBeInTheDocument();
  });

  it("opens category help without scoring", async () => {
    const user = userEvent.setup();
    const onScore = vi.fn();
    const help = getScoreHelp("yatzy", "ones");

    render(
      <ScoreSheet
        state={baseState()}
        playerLabels={{ "user-a": "You", "user-b": "Player 2" }}
        currentUserId="user-a"
        canScore
        onScore={onScore}
      />,
    );

    await user.click(screen.getByRole("button", { name: "About Ones" }));
    expect(screen.getByText(help.what)).toBeInTheDocument();
    expect(screen.getByText(help.example)).toBeInTheDocument();
    expect(onScore).not.toHaveBeenCalled();
  });
});
