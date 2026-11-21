import { describe, expect, it } from "vitest";
import { yahtzeeCategories, yatzyCategories } from "./categories";
import { getRulesetCompareHelp, getScoreHelp, getTurnHelp, type ScoreHelpKey } from "./help";

const footers: ScoreHelpKey[] = ["upper_total", "bonus", "total"];

describe("getScoreHelp", () => {
  it("covers every yatzy category plus footers", () => {
    for (const key of [...yatzyCategories, ...footers]) {
      const help = getScoreHelp("yatzy", key);
      expect(help.title.length).toBeGreaterThan(0);
      expect(help.what.length).toBeGreaterThan(0);
      expect(help.score.length).toBeGreaterThan(0);
      expect(help.example.length).toBeGreaterThan(0);
    }
  });

  it("covers every yahtzee category plus footers", () => {
    for (const key of [...yahtzeeCategories, ...footers]) {
      const help = getScoreHelp("yahtzee", key);
      expect(help.title.length).toBeGreaterThan(0);
      expect(help.what.length).toBeGreaterThan(0);
      expect(help.score.length).toBeGreaterThan(0);
      expect(help.example.length).toBeGreaterThan(0);
    }
  });

  it("documents yatzy ones example matching scoreCategory", () => {
    expect(getScoreHelp("yatzy", "ones").example).toMatch(/1-1-1-2-3/);
    expect(getScoreHelp("yatzy", "ones").example).toMatch(/→\s*3/);
  });

  it("uses fixed 25 for yahtzee full house and sum for yatzy", () => {
    expect(getScoreHelp("yahtzee", "full_house").score).toMatch(/25/);
    expect(getScoreHelp("yatzy", "full_house").score.toLowerCase()).toMatch(/sum/);
  });
});

describe("getRulesetCompareHelp", () => {
  it("returns a short contrast with pairs and scoring splits", () => {
    const help = getRulesetCompareHelp();
    expect(help.title.length).toBeGreaterThan(0);
    expect(help.body.length).toBeGreaterThanOrEqual(3);
    const joined = help.body.join(" ").toLowerCase();
    expect(joined).toMatch(/pair/);
    expect(joined).toMatch(/25/);
    expect(joined).toMatch(/sum/);
  });
});

describe("getTurnHelp", () => {
  it("covers rolls and hold", () => {
    const help = getTurnHelp();
    expect(help.title.length).toBeGreaterThan(0);
    expect(help.body.length).toBeGreaterThanOrEqual(3);
    const joined = help.body.join(" ").toLowerCase();
    expect(joined).toMatch(/roll/);
    expect(joined).toMatch(/hold/);
  });
});
