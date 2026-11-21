import { describe, expect, it } from "vitest";
import { scoreCategory } from "./score";

describe("scoreCategory yatzy", () => {
  it("scores ones as sum of 1s", () => {
    expect(scoreCategory("yatzy", "ones", [1, 1, 2, 3, 1])).toBe(3);
  });

  it("scores one pair as highest pair face * 2", () => {
    expect(scoreCategory("yatzy", "one_pair", [3, 3, 5, 5, 2])).toBe(10);
  });

  it("scores yatzy as 50", () => {
    expect(scoreCategory("yatzy", "yatzy", [4, 4, 4, 4, 4])).toBe(50);
  });

  it("scores large straight (2-6) as 20", () => {
    expect(scoreCategory("yatzy", "large_straight", [2, 3, 4, 5, 6])).toBe(20);
  });

  it("scores three of a kind (yatzy) as face * 3", () => {
    expect(scoreCategory("yatzy", "three_kind", [3, 3, 3, 1, 2])).toBe(9);
  });

  it("scores four of a kind (yatzy) as face * 4", () => {
    expect(scoreCategory("yatzy", "four_kind", [4, 4, 4, 4, 1])).toBe(16);
  });
});

describe("scoreCategory yahtzee", () => {
  it("scores full house as 25", () => {
    expect(scoreCategory("yahtzee", "full_house", [2, 2, 2, 5, 5])).toBe(25);
  });

  it("scores small straight as 30", () => {
    expect(scoreCategory("yahtzee", "small_straight", [1, 2, 3, 4, 6])).toBe(30);
  });

  it("scores yahtzee as 50", () => {
    expect(scoreCategory("yahtzee", "yahtzee", [6, 6, 6, 6, 6])).toBe(50);
  });

  it("scores three of a kind (yahtzee) as sum of all dice", () => {
    expect(scoreCategory("yahtzee", "three_kind", [2, 2, 2, 3, 4])).toBe(13);
  });

  it("scores four of a kind (yahtzee) as sum of all dice", () => {
    expect(scoreCategory("yahtzee", "four_kind", [5, 5, 5, 5, 2])).toBe(22);
  });
});
