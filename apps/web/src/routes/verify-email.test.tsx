import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authClient } from "../lib/auth-client";
import { VerifyEmailPage } from "./verify-email";

vi.mock("../lib/auth-client", () => ({
  authClient: { verifyEmail: vi.fn() },
  googleEnabled: vi.fn(),
}));

const verifyEmail = vi.mocked(authClient.verifyEmail);

function renderPage(url = "/verify-email?token=jwt.token.here") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("VerifyEmailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("confirms the address it was given", async () => {
    verifyEmail.mockResolvedValue({ data: { status: true }, error: null } as never);

    renderPage();

    expect(await screen.findByText(/that address is yours/i)).toBeVisible();
    expect(verifyEmail).toHaveBeenCalledWith({ query: { token: "jwt.token.here" } });
    expect(screen.getByRole("link", { name: /go to the lobby/i })).toHaveAttribute(
      "href",
      "/lobby",
    );
  });

  it("says plainly that an expired link failed", async () => {
    verifyEmail.mockResolvedValue({
      data: null,
      error: { message: "Invalid token", status: 401 },
    } as never);

    renderPage();

    expect(await screen.findByText(/invalid token/i)).toBeVisible();
    expect(screen.queryByText(/that address is yours/i)).not.toBeInTheDocument();
  });

  it("does not call the API without a token", async () => {
    renderPage("/verify-email");

    expect(await screen.findByText(/missing its token/i)).toBeVisible();
    expect(verifyEmail).not.toHaveBeenCalled();
  });
});
