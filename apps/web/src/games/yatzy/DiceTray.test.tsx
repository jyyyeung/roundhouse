import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiceTray } from "./DiceTray";

const baseProps = {
  dice: [1, 2, 3, 4, 5],
  holds: [false, true, false, false, false],
  rollsLeft: 2,
  canRoll: true,
  canToggleHolds: true,
  rollVersion: 1,
  onToggleHold: vi.fn(),
  onRoll: vi.fn(),
};

describe("DiceTray", () => {
  it("renders DieFace for each die instead of roman numerals", () => {
    render(<DiceTray {...baseProps} />);

    const faces = screen.getAllByTestId("die-face");
    expect(faces).toHaveLength(5);
    expect(faces.map((face) => face.getAttribute("data-value"))).toEqual(["1", "2", "3", "4", "5"]);
    expect(screen.queryByText("II")).not.toBeInTheDocument();
    expect(screen.queryByText("V")).not.toBeInTheDocument();
  });

  it("keeps hold controls on the outer buttons", () => {
    render(<DiceTray {...baseProps} />);

    expect(screen.getByRole("button", { name: /hold die 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /release die 2/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("caps die buttons so they do not stretch full column width", () => {
    render(<DiceTray {...baseProps} />);

    const die = screen.getByRole("button", { name: /hold die 1/i });
    expect(die.className).toMatch(/size-12/);
    expect(die.className).toMatch(/md:size-14/);
    expect(die.className).not.toMatch(/aspect-square/);
  });

  it("centers the dice row", () => {
    const { container } = render(<DiceTray {...baseProps} />);
    const row = container.querySelector(".dice-row");
    expect(row?.className).toMatch(/justify-center/);
  });
});
