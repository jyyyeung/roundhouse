import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InfoTip } from "./InfoTip";

describe("InfoTip", () => {
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

  it("toggles content on trigger click", async () => {
    const user = userEvent.setup();
    render(<InfoTip label="About Ones">Sum of ones</InfoTip>);

    expect(screen.queryByText("Sum of ones")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "About Ones" }));
    expect(screen.getByText("Sum of ones")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "About Ones" }));
    expect(screen.queryByText("Sum of ones")).not.toBeInTheDocument();
  });
});
