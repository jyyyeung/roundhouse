import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DieFace } from "./DieFace";

describe("DieFace", () => {
  it("renders five pips for value 5 with soft variant by default", () => {
    render(<DieFace value={5} />);

    const face = screen.getByTestId("die-face");
    expect(face).toHaveAttribute("data-value", "5");
    expect(face).toHaveAttribute("data-variant", "soft");
    expect(face.querySelectorAll("[data-pip]")).toHaveLength(5);
  });

  it("renders no pips for value 0", () => {
    render(<DieFace value={0} />);

    const face = screen.getByTestId("die-face");
    expect(face).toHaveAttribute("data-value", "0");
    expect(face.querySelectorAll("[data-pip]")).toHaveLength(0);
  });

  it("supports classic variant without soft chrome class", () => {
    render(<DieFace value={3} variant="classic" />);

    const face = screen.getByTestId("die-face");
    expect(face).toHaveAttribute("data-variant", "classic");
    expect(face.className).not.toMatch(/die-face--soft/);
    expect(face.querySelectorAll("[data-pip]")).toHaveLength(3);
  });
});
