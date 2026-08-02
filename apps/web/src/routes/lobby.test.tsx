import { render, screen, waitFor } from "@testing-library/react";
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
    expect(actionClasses).toContain("md:grid");
    expect(actionClasses).toContain("md:grid-cols-2");

    expect(screen.getByText(/create table/i)).toBeInTheDocument();
    expect(screen.getByText(/join by code/i)).toBeInTheDocument();
  });
});
