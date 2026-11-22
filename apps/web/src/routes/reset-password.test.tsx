import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authClient } from "../lib/auth-client";
import { ResetPasswordPage } from "./reset-password";

vi.mock("../lib/auth-client", () => ({
  authClient: { resetPassword: vi.fn() },
  googleEnabled: vi.fn(),
}));

const resetPassword = vi.mocked(authClient.resetPassword);

function renderPage(url = "/reset-password?token=abc.def.ghi") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<p>sign in screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses a mismatch without spending the token", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^new password$/i), "correct horse battery");
    await user.type(screen.getByLabelText(/repeat it/i), "correct horse batteru");
    await user.click(screen.getByRole("button", { name: /save and sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/do not match/i);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("spends the token, then hands over to sign-in with a notice", async () => {
    resetPassword.mockResolvedValue({ data: { status: true }, error: null } as never);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^new password$/i), "correct horse battery");
    await user.type(screen.getByLabelText(/repeat it/i), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /save and sign in/i }));

    await waitFor(() => {
      expect(resetPassword).toHaveBeenCalledWith({
        newPassword: "correct horse battery",
        token: "abc.def.ghi",
      });
    });
    expect(await screen.findByText("sign in screen")).toBeVisible();
  });

  it("shows the server's answer when the link is spent or expired", async () => {
    resetPassword.mockResolvedValue({
      data: null,
      error: { message: "Invalid token", status: 400 },
    } as never);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^new password$/i), "correct horse battery");
    await user.type(screen.getByLabelText(/repeat it/i), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /save and sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid token/i);
    expect(screen.queryByText("sign in screen")).not.toBeInTheDocument();
  });

  it("explains a link with no token instead of showing a form that cannot work", () => {
    renderPage("/reset-password");
    expect(screen.getByText(/missing its token/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /save and sign in/i })).not.toBeInTheDocument();
  });
});
