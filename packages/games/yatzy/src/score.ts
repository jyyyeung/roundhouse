import type { Category, Dice, Ruleset } from "./types";

function counts(dice: Dice) {
  const m: Record<number, number> = {};
  for (const d of dice) m[d] = (m[d] || 0) + 1;
  return m;
}

function sum(dice: Dice) {
  return dice.reduce((a, b) => a + b, 0);
}

export function scoreCategory(ruleset: Ruleset, category: Category, dice: Dice): number {
  const m = counts(dice);
  const faces = Object.keys(m).map((k) => Number(k));

  // Upper section
  if (
    category === "ones" ||
    category === "twos" ||
    category === "threes" ||
    category === "fours" ||
    category === "fives" ||
    category === "sixes"
  ) {
    const target = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 }[
      category
    ] as number;
    return (m[target] || 0) * target;
  }

  // Pairs / kinds
  if (category === "one_pair") {
    const pairs = faces.filter((f) => m[f] >= 2).sort((a, b) => b - a);
    return pairs.length ? pairs[0] * 2 : 0;
  }

  if (category === "two_pairs") {
    const pairs = faces.filter((f) => m[f] >= 2).sort((a, b) => b - a);
    return pairs.length >= 2 ? pairs[0] * 2 + pairs[1] * 2 : 0;
  }

  if (category === "three_kind") {
    const fk = faces.find((f) => m[f] >= 3);
    if (!fk) return 0;
    return ruleset === "yahtzee" ? sum(dice) : fk * 3;
  }

  if (category === "four_kind") {
    const fk = faces.find((f) => m[f] >= 4);
    if (!fk) return 0;
    return ruleset === "yahtzee" ? sum(dice) : fk * 4;
  }

  if (category === "chance") return sum(dice);

  // Straights and full house / yatzy
  if (category === "small_straight") {
    if (ruleset === "yatzy") {
      const set = new Set(dice);
      const want = [1, 2, 3, 4, 5];
      return want.every((n) => set.has(n)) ? 15 : 0;
    } else {
      // yahtzee: any run of 4 numbers (1-4,2-5,3-6)
      const set = new Set(dice);
      const seqs = [
        [1, 2, 3, 4],
        [2, 3, 4, 5],
        [3, 4, 5, 6],
      ];
      return seqs.some((s) => s.every((n) => set.has(n))) ? 30 : 0;
    }
  }

  if (category === "large_straight") {
    const set = new Set(dice);
    const want1 = [1, 2, 3, 4, 5];
    const want2 = [2, 3, 4, 5, 6];
    if (ruleset === "yatzy") {
      return want2.every((n) => set.has(n)) ? 20 : 0;
    } else {
      return want1.every((n) => set.has(n)) || want2.every((n) => set.has(n)) ? 40 : 0;
    }
  }

  if (category === "full_house") {
    // yatzy: sum of dice when 3+2; yahtzee: fixed 25 when 3+2
    const countsArr = Object.values(m).sort((a, b) => b - a);
    const isFull = countsArr.length === 2 && countsArr[0] === 3 && countsArr[1] === 2;
    if (!isFull) return 0;
    return ruleset === "yatzy" ? sum(dice) : 25;
  }

  if (category === "yatzy" || category === "yahtzee") {
    const c = Object.values(m)[0];
    return c === 5 ? 50 : 0;
  }

  return 0;
}

export default scoreCategory;
