import {
  type Ruleset,
  type Sheet,
  scoreCategory,
  type YatzyView,
  yahtzeeCategories,
  yatzyCategories,
} from "@roundhouse/game-yatzy";

export function categoriesFor(ruleset: Ruleset) {
  return ruleset === "yahtzee" ? yahtzeeCategories : yatzyCategories;
}

export function formatCategory(category: string) {
  return category.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function upperTotal(sheet: Sheet) {
  return ["ones", "twos", "threes", "fours", "fives", "sixes"].reduce(
    (sum, key) => sum + (sheet[key] ?? 0),
    0,
  );
}

export function totalScore(state: YatzyView, playerId: string) {
  const sheet = state.sheets[playerId];
  if (!sheet) return 0;

  return (
    categoriesFor(state.ruleset).reduce((sum, category) => sum + (sheet[category] ?? 0), 0) +
    (sheet.bonus ?? 0)
  );
}

export function previewScore(state: YatzyView, category: string) {
  if (state.dice.every((die) => die === 0)) return null;
  return scoreCategory(
    state.ruleset,
    category as never,
    state.dice as [number, number, number, number, number],
  );
}

export function readChatSnapshot(snapshot: unknown) {
  const state = (
    snapshot &&
    typeof snapshot === "object" &&
    "state" in snapshot &&
    snapshot.state &&
    typeof snapshot.state === "object"
      ? snapshot.state
      : snapshot
  ) as {
    dice?: number[];
    holds?: boolean[];
    rollsLeft?: number;
  } | null;

  return {
    dice: Array.isArray(state?.dice) ? state.dice : [],
    holds: Array.isArray(state?.holds) ? state.holds : [],
    rollsLeft: typeof state?.rollsLeft === "number" ? state.rollsLeft : null,
  };
}
