import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LobbyPage } from "./lobby";
import * as tables from "../lib/tables";

vi.mock("../lib/tables", async () => {
  const actual = await vi.importActual<typeof import("../lib/tables")>("../lib/tables");
  return {
    ...actual,
    getRecentTables: vi.fn(),
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
  });

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
      expect(screen.getByText("Yatzy")).toBeInTheDocument();
    });

    const row = container.querySelector(".lobby-recent-row");
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
});
