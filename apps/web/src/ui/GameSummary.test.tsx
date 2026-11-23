import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameSummary } from "../lib/summary";
import { summaryText } from "../lib/summary";
import {
  canRenderSummaryImage,
  downloadSummaryImage,
  renderSummaryImage,
} from "../lib/summary-image";
import { GameSummaryCard } from "./GameSummary";

vi.mock("../lib/summary-image", () => ({
  canRenderSummaryImage: vi.fn(() => true),
  downloadSummaryImage: vi.fn(),
  renderSummaryImage: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
}));

const labels = { "user-a": "You", "user-b": "Player 2" };

const summary: GameSummary = {
  lines: [{ label: "Best category", value: "Fives — 20" }],
  rounds: 14,
  standings: [
    { playerId: "user-a", total: 187 },
    { playerId: "user-b", total: 214 },
  ],
  winners: ["user-b"],
};

const card = { labels, summary, title: "Riverside Yatzy" };

beforeEach(() => {
  vi.mocked(canRenderSummaryImage).mockReturnValue(true);
});

describe("GameSummaryCard", () => {
  it("names the winner and ranks the standings highest total first", () => {
    render(<GameSummaryCard {...card} />);

    expect(screen.getByTestId("game-summary-headline")).toHaveTextContent("Player 2 wins");

    const rows = within(screen.getByTestId("game-summary-standings")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual(["1Player 2214", "2You187"]);
  });

  it("shows the rounds and the game's own extra lines", () => {
    render(<GameSummaryCard {...card} />);

    expect(screen.getByTestId("game-summary-rounds")).toHaveTextContent("14 rounds");
    expect(screen.getByTestId("game-summary-lines")).toHaveTextContent("Best category");
    expect(screen.getByTestId("game-summary-lines")).toHaveTextContent("Fives — 20");
  });

  it("drops the ranking rather than breaking when the game publishes no totals", () => {
    render(
      <GameSummaryCard
        labels={labels}
        summary={{ standings: [], winners: [], lines: undefined, rounds: undefined }}
        title="Duel"
      />,
    );

    expect(screen.queryByTestId("game-summary-standings")).toBeNull();
    expect(screen.queryByTestId("game-summary-rounds")).toBeNull();
    expect(screen.queryByTestId("game-summary-lines")).toBeNull();
    expect(screen.getByTestId("game-summary-headline")).toHaveTextContent("A draw");
  });

  it("copies the same text it renders", async () => {
    const user = userEvent.setup();
    // After `setup()`: userEvent installs its own clipboard stub, so spying
    // before it runs would watch an object the click never reaches.
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<GameSummaryCard {...card} />);

    await user.click(screen.getByRole("button", { name: /copy summary/i }));

    expect(writeText).toHaveBeenCalledWith(summaryText(card));
    expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
  });

  it("saves the rendered image under a name built from the table title", async () => {
    const user = userEvent.setup();
    render(<GameSummaryCard {...card} />);

    await user.click(screen.getByRole("button", { name: /save image/i }));

    expect(renderSummaryImage).toHaveBeenCalledWith(card);
    expect(downloadSummaryImage).toHaveBeenCalledWith(
      expect.any(Blob),
      "riverside-yatzy-result.png",
    );
  });

  it("offers the text instead of the picture when the browser cannot draw", () => {
    vi.mocked(canRenderSummaryImage).mockReturnValue(false);
    render(<GameSummaryCard {...card} />);

    expect(screen.queryByRole("button", { name: /save image/i })).toBeNull();
    expect(screen.getByTestId("game-summary-fallback")).toHaveTextContent("Player 2 wins");
    expect(screen.getByRole("button", { name: /copy summary/i })).toBeInTheDocument();
  });
});
