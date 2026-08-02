import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatDiceChips } from "./ChatDiceChips";

describe("ChatDiceChips", () => {
  it("labels the row with dice values and 1-based held indices", () => {
    render(<ChatDiceChips dice={[6, 6, 6, 4, 2]} holds={[true, true, true, false, false]} />);

    expect(screen.getByLabelText("Dice 6, 6, 6, 4, 2; held 1, 2, 3")).toBeInTheDocument();
  });

  it("omits the held clause when nothing is held", () => {
    render(<ChatDiceChips dice={[1, 2, 3, 4, 5]} holds={[false, false, false, false, false]} />);

    expect(screen.getByLabelText("Dice 1, 2, 3, 4, 5")).toBeInTheDocument();
  });

  it("treats missing holds as free and styles held chips with teal classes", () => {
    const { container } = render(<ChatDiceChips dice={[6, 4]} holds={[true]} />);

    const chips = container.querySelectorAll("[data-chip]");
    expect(chips).toHaveLength(2);
    expect(chips[0]?.className).toMatch(/bg-\[var\(--color-teal\)\]/);
    expect(chips[0]?.className).toMatch(/border-\[var\(--color-teal-deep\)\]/);
    expect(chips[1]?.className).toMatch(/bg-white/);
    expect(chips[1]?.className).toMatch(/border-slate-200/);
    expect(screen.getByLabelText("Dice 6, 4; held 1")).toBeInTheDocument();
  });
});
