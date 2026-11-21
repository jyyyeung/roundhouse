import { getRulesetCompareHelp } from "@roundhouse/game-yatzy";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tables from "../lib/tables";
import { LobbyPage } from "./lobby";

vi.mock("../lib/tables", async () => {
  const actual = await vi.importActual<typeof import("../lib/tables")>("../lib/tables");
  return {
    ...actual,
    getRecentTables: vi.fn(),
    getGameCatalogue: vi.fn(),
    createTable: vi.fn(),
    joinTable: vi.fn(),
  };
});

vi.mock("../lib/auth-client", () => ({
  authClient: {
    signOut: vi.fn(),
  },
}));

const getRecentTables = vi.mocked(tables.getRecentTables);
const getGameCatalogue = vi.mocked(tables.getGameCatalogue);
const createTable = vi.mocked(tables.createTable);

const yatzyEntry = {
  id: "yatzy",
  displayName: "Yatzy",
  playerCount: { min: 2, max: 6 },
  defaultConfig: { ruleset: "yatzy" },
};

function renderLobby() {
  return render(
    <MemoryRouter>
      <LobbyPage session={{ user: { name: "Ada", email: "ada@example.com" } }} />
    </MemoryRouter>,
  );
}

describe("LobbyPage layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentTables.mockResolvedValue([]);
    getGameCatalogue.mockResolvedValue([yatzyEntry]);
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
  afterEach(() => vi.unstubAllGlobals());

  it("widens the shell and grids create/join at md+", async () => {
    const { container } = renderLobby();

    await waitFor(() => {
      expect(getRecentTables).toHaveBeenCalled();
    });

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toMatch(/max-w-md/);
    expect(shell.className).toMatch(/md:max-w-5xl/);

    const actions = container.querySelector(".lobby-actions");
    const actionClasses = actions?.className.split(/\s+/) ?? [];
    expect(actionClasses).toContain("grid");
    expect(actionClasses).toContain("grid-cols-1");
    expect(actionClasses).toContain("md:grid-cols-2");

    expect(screen.getByRole("button", { name: /^create table$/i })).toBeInTheDocument();
    expect(screen.getByText(/join by code/i)).toBeInTheDocument();
    expect(screen.getByText("Roundhouse")).toBeInTheDocument();
  });

  it("renders denser recent-table row classes and copies the share url", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    getRecentTables.mockResolvedValue([
      {
        id: "table-1",
        code: "Z2YL8J",
        gameId: "yatzy",
        config: { ruleset: "yatzy" },
        status: "active",
        hostUserId: "user-a",
        softSeatCap: 4,
        createdAt: "2026-08-02T00:00:00.000Z",
        seatUserIds: ["user-a", "user-b"],
      },
    ]);

    const { container } = renderLobby();

    await waitFor(() => {
      expect(container.querySelector(".lobby-recent-row")).not.toBeNull();
    });

    // Scoped to the row: with one game in the catalogue the only other "Yatzy"
    // on the page is an option in the game's own ruleset picker.
    const row = container.querySelector(".lobby-recent-row") as HTMLElement;
    expect(within(row).getByText("Yatzy")).toBeInTheDocument();
    expect(row?.className).toMatch(/md:flex/);
    expect(row?.className).toMatch(/md:items-center/);

    const url = screen.getByText(/\/t\/table-1/);
    expect(url.className).toMatch(/md:truncate/);

    const copy = screen.getByRole("button", { name: /copy link/i });
    expect(copy.className).toMatch(/md:inline-flex/);
    expect(copy.className).toMatch(/hidden/);

    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/t/table-1"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("code=Z2YL8J"));
  });

  it("shows ruleset contrast help beside the picker", async () => {
    const user = userEvent.setup();
    const help = getRulesetCompareHelp();

    renderLobby();
    // The ruleset picker belongs to the game, so it only appears once the
    // server's catalogue says which games exist.
    await screen.findByRole("combobox", { name: /ruleset/i });

    expect(screen.getByRole("button", { name: "About rulesets" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "About rulesets" }));
    expect(screen.getByText(help.title)).toBeInTheDocument();
    expect(screen.getByText(help.body[0]!)).toBeInTheDocument();
    // Ensure clicking the InfoTip does not change the select value or focus the select
    const select = screen.getByRole("combobox", { name: /ruleset/i }) as HTMLSelectElement;
    expect(select.value).toBe("yatzy");
    expect(document.activeElement).not.toBe(select);
  });

  it("creates a table with the game the catalogue offered", async () => {
    const user = userEvent.setup();
    createTable.mockResolvedValue({ tableId: "table-9", code: "ABC234" });

    renderLobby();
    await screen.findByRole("combobox", { name: /ruleset/i });
    await user.click(screen.getByRole("button", { name: /^create table$/i }));

    await waitFor(() => {
      expect(createTable).toHaveBeenCalledWith({ gameId: "yatzy", config: { ruleset: "yatzy" } });
    });
  });

  it("follows the catalogue when the server hosts more than one game", async () => {
    getGameCatalogue.mockResolvedValue([
      yatzyEntry,
      {
        id: "duel",
        displayName: "Duel",
        playerCount: { min: 2, max: 2 },
        defaultConfig: { rounds: 3 },
      },
    ]);

    renderLobby();
    const picker = (await screen.findByRole("combobox", { name: /game/i })) as HTMLSelectElement;
    expect(Array.from(picker.options).map((option) => option.value)).toEqual(["yatzy", "duel"]);
    // Yatzy's own controls are rendered for yatzy; the lobby never learns what a
    // ruleset is beyond the component the game hands it.
    expect(screen.getByRole("combobox", { name: /ruleset/i })).toBeInTheDocument();
  });
});
