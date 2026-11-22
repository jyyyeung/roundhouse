import type { TableReplay } from "@roundhouse/game-core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getTableReplay } from "../lib/tables";
import { ReplayPage } from "./replay";

vi.mock("../lib/tables", async () => {
  const actual = await vi.importActual<typeof import("../lib/tables")>("../lib/tables");
  return { ...actual, getTableReplay: vi.fn() };
});

const mockedGetTableReplay = vi.mocked(getTableReplay);

function emptySheet() {
  return {
    ones: null,
    twos: null,
    threes: null,
    fours: null,
    fives: null,
    sixes: null,
    one_pair: null,
    two_pairs: null,
    three_of_a_kind: null,
    four_of_a_kind: null,
    small_straight: null,
    large_straight: null,
    full_house: null,
    chance: null,
    yatzy: null,
    bonus: null,
  };
}

function view(overrides: Record<string, unknown> = {}) {
  return {
    gameId: "yatzy",
    ruleset: "yatzy",
    playerIds: ["user-a", "user-b"],
    currentPlayerId: "user-a",
    rollsLeft: 3,
    dice: [1, 1, 1, 1, 1],
    holds: [false, false, false, false, false],
    sheets: { "user-a": emptySheet(), "user-b": emptySheet() },
    phase: "playing",
    winnerIds: [],
    you: 0,
    ...overrides,
  };
}

function replayFixture(): TableReplay {
  return {
    tableId: "table-1",
    gameId: "yatzy",
    finishedAt: "2026-11-22T00:00:00.000Z",
    meta: {
      code: "ABCD23",
      gameId: "yatzy",
      config: { ruleset: "yatzy" },
      status: "finished",
      hostUserId: "user-a",
      seatUserIds: ["user-a", "user-b"],
      softSeatCap: 6,
    },
    turns: [
      {
        seq: 1,
        actorId: "user-a",
        phrase: "rolled 1 1 1 1 1",
        view: view({ rollsLeft: 2 }),
      },
      {
        seq: 2,
        actorId: "user-b",
        phrase: "scored ones for 5",
        view: view({ dice: [6, 6, 6, 6, 6], rollsLeft: 2, you: null }),
      },
      {
        seq: 3,
        actorId: "user-b",
        phrase: "finished the game",
        view: view({ dice: [6, 6, 6, 6, 6], phase: "finished", rollsLeft: 0, you: null }),
      },
    ],
  } as TableReplay;
}

function renderReplayPage(entry = "/t/table-1/replay") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/t/:tableId/replay"
          element={<ReplayPage session={{ user: { id: "user-a" } }} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ReplayPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetTableReplay.mockResolvedValue(replayFixture());
  });

  it("opens on the final board and names each step", async () => {
    renderReplayPage();

    expect(await screen.findByTestId("replay-step")).toHaveTextContent(
      "3 / 3 — Player 2 finished the game",
    );
    expect(mockedGetTableReplay).toHaveBeenCalledWith("table-1");
  });

  it("moves one step at a time with the buttons and stops at both ends", async () => {
    const user = userEvent.setup();
    renderReplayPage();

    const previous = await screen.findByRole("button", { name: "Previous step" });
    const next = screen.getByRole("button", { name: "Next step" });
    expect(next).toBeDisabled();

    await user.click(previous);
    expect(screen.getByTestId("replay-step")).toHaveTextContent(
      "2 / 3 — Player 2 scored ones for 5",
    );

    await user.click(previous);
    expect(screen.getByTestId("replay-step")).toHaveTextContent("1 / 3 — You rolled 1 1 1 1 1");
    expect(previous).toBeDisabled();

    await user.click(next);
    expect(screen.getByTestId("replay-step")).toHaveTextContent(
      "2 / 3 — Player 2 scored ones for 5",
    );
  });

  it("scrubs with the arrow keys", async () => {
    const user = userEvent.setup();
    renderReplayPage();

    await screen.findByTestId("replay-step");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("replay-step")).toHaveTextContent("2 / 3");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByTestId("replay-step")).toHaveTextContent("1 / 3");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("replay-step")).toHaveTextContent("2 / 3");
  });

  it("renders the board of the step it is on", async () => {
    const user = userEvent.setup();
    renderReplayPage();

    await screen.findByTestId("replay-step");
    expect(screen.getByLabelText("Die 1: 6")).toBeInTheDocument();
    expect(screen.getByText("0 rolls left")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous step" }));
    await user.click(screen.getByRole("button", { name: "Previous step" }));
    expect(screen.getByLabelText("Die 1: 1")).toBeInTheDocument();
    expect(screen.getByText("2 rolls left")).toBeInTheDocument();
  });

  it("offers no controls that could change a finished game", async () => {
    renderReplayPage();

    await screen.findByTestId("replay-step");
    expect(screen.queryByRole("button", { name: /roll dice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /chat/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hold die/i })).not.toBeInTheDocument();
    // Five dice, drawn rather than offered.
    expect(screen.getAllByRole("img")).toHaveLength(5);
    for (const cell of screen.queryAllByRole("button", { name: /score/i })) {
      expect(cell).toBeDisabled();
    }
  });

  it("renders the not-found notice for a table that is gone", async () => {
    mockedGetTableReplay.mockRejectedValue(new ApiError("table_missing", "table_missing", 404));

    renderReplayPage();

    expect(await screen.findByRole("status")).toHaveAttribute("data-notice-kind", "not-found");
    expect(screen.getByRole("alert")).toHaveTextContent("table_missing");
  });

  it("sends a player back to the live table when the game has not finished", async () => {
    mockedGetTableReplay.mockRejectedValue(
      new ApiError("table_not_finished", "table_not_finished", 409),
    );

    renderReplayPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("This game is still being played");
    await waitFor(() => expect(mockedGetTableReplay).toHaveBeenCalledTimes(1));
  });
});
