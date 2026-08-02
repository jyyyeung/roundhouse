import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { authClient } from "./lib/auth-client";

vi.mock("./lib/auth-client", () => ({
  authClient: {
    useSession: vi.fn(),
    signOut: vi.fn(),
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
  },
}));

const mockedUseSession = vi.mocked(authClient.useSession);

function mockSession(session: unknown) {
  mockedUseSession.mockReturnValue({
    data: session,
    error: null,
    isPending: false,
    refetch: vi.fn(),
  } as never);
}

describe("app routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects guests away from the lobby", () => {
    mockSession(null);

    render(
      <MemoryRouter initialEntries={["/lobby"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows the table placeholder for signed-in players", () => {
    mockSession({ user: { email: "player@example.com" } });

    render(
      <MemoryRouter initialEntries={["/t/table-123"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText("table-123")).toBeInTheDocument();
    expect(screen.getByText(/table ui lands in task 11/i)).toBeInTheDocument();
  });
});
