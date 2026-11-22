import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { isSoundEnabled, resetSoundPreference } from "../lib/feedback";
import { SoundToggle } from "./SoundToggle";

describe("SoundToggle", () => {
  beforeEach(() => {
    resetSoundPreference();
    globalThis.localStorage.clear();
  });

  it("is an off, labelled, keyboard-reachable button by default", async () => {
    const user = userEvent.setup();
    render(<SoundToggle />);

    const button = screen.getByRole("button", { name: /turn sound on/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("type", "button");

    button.focus();
    expect(button).toHaveFocus();

    await user.click(button);

    expect(isSoundEnabled()).toBe(true);
    expect(screen.getByRole("button", { name: /turn sound off/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(globalThis.localStorage.getItem("roundhouse:sound")).toBe("on");
  });

  it("persists going silent again", async () => {
    const user = userEvent.setup();
    render(<SoundToggle />);

    await user.click(screen.getByRole("button", { name: /turn sound on/i }));
    await user.click(screen.getByRole("button", { name: /turn sound off/i }));

    expect(isSoundEnabled()).toBe(false);
    expect(globalThis.localStorage.getItem("roundhouse:sound")).toBe("off");
  });
});
