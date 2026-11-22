import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authClient, googleEnabled } from "../lib/auth-client";
import { LoginPage } from "./login";

vi.mock("../lib/auth-client", () => ({
  authClient: {
    requestPasswordReset: vi.fn(),
    signIn: { email: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
  },
  googleEnabled: vi.fn(),
}));

const requestPasswordReset = vi.mocked(authClient.requestPasswordReset);
const signUp = vi.mocked(authClient.signUp.email);
const signInSocial = vi.mocked(authClient.signIn.social);
const mockedGoogleEnabled = vi.mocked(googleEnabled);

function form(): HTMLElement {
  const element = document.querySelector("form");
  if (!element) throw new Error("form not rendered");
  return element;
}

function renderLogin(initial = "/login") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/login" element={<LoginPage session={{ data: null, isPending: false }} />} />
        <Route path="/lobby" element={<p>lobby screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoginPage recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGoogleEnabled.mockResolvedValue(false);
  });

  it("asks for a reset link and says nothing about whether the account exists", async () => {
    requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null } as never);
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("button", { name: /forgot your password/i }));
    await user.type(screen.getByLabelText(/email/i), "ada@example.com");
    await user.click(screen.getByRole("button", { name: /email me a link/i }));

    await waitFor(() => {
      expect(requestPasswordReset).toHaveBeenCalledWith({ email: "ada@example.com" });
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      /if ada@example\.com has an account/i,
    );
    expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
  });

  it("sends the player to the check-your-email step after asking for a new account under verification", async () => {
    // Strict mode: the account is created but no session is issued.
    signUp.mockResolvedValue({ data: { token: null, user: { id: "u1" } }, error: null } as never);
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("button", { name: /create account/i }));
    await user.type(screen.getByLabelText(/email/i), "ada@example.com");
    await user.type(screen.getByLabelText(/password/i), "correct horse battery");
    // The mode tab is labelled the same as the submit button; the form's is the one that submits.
    await user.click(within(form()).getByRole("button", { name: /^create account$/i }));

    expect(
      await screen.findByText(/we sent a confirmation link to ada@example\.com/i),
    ).toBeVisible();
    expect(screen.queryByText("lobby screen")).not.toBeInTheDocument();
  });

  it("offers Google only when the server reports it configured", async () => {
    const first = renderLogin();
    await waitFor(() => expect(mockedGoogleEnabled).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /continue with google/i })).not.toBeInTheDocument();
    first.unmount();

    mockedGoogleEnabled.mockResolvedValue(true);
    const user = userEvent.setup();
    renderLogin();
    const button = await screen.findByRole("button", { name: /continue with google/i });
    await user.click(button);
    expect(signInSocial).toHaveBeenCalledWith({ callbackURL: "/lobby", provider: "google" });
  });

  it("shows the notice a reset handed over on the way back to sign-in", () => {
    // The notice travels as router state from the reset page; simulate it.
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/login", state: { notice: "Password updated. Sign in with the new one." } },
        ]}
      >
        <Routes>
          <Route path="/login" element={<LoginPage session={{ data: null, isPending: false }} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/password updated\. sign in with the new one/i)).toBeVisible();
  });
});
