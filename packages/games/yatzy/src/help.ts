import { yahtzeeCategories, yatzyCategories } from "./categories";
import type { Category, Ruleset } from "./types";

export type ScoreHelp = {
  title: string;
  what: string;
  score: string;
  example: string;
};

export type ScoreHelpKey = Category | "upper_total" | "bonus" | "total";

export type SurfaceHelp = {
  title: string;
  body: string[];
};

export function getRulesetCompareHelp(): SurfaceHelp {
  return {
    title: "Yatzy vs Yahtzee",
    body: [
      "Yatzy includes One pair and Two pairs; Yahtzee does not.",
      "Three / four of a kind: Yatzy scores face × N; Yahtzee scores the sum of all five dice.",
      "Straights / full house: Yatzy uses exact sequences (small 15, large 20) and full house = sum of dice; Yahtzee uses any four-run small straight (30), either five-run large straight (40), and full house = 25.",
      "Open a category ⓘ on the score sheet for full per-row detail.",
    ],
  };
}

export function getTurnHelp(): SurfaceHelp {
  return {
    title: "How a turn works",
    body: [
      "Up to 3 rolls per turn; “rolls left” is remaining rolls this turn.",
      "Tap a die to hold or release (teal = held); holds unlock after the first roll of the turn.",
      "After rolling, lock any open category on the sheet (including 0) to end the turn — you may score before using all rolls.",
    ],
  };
}

function upperHelp(face: number, title: string, exampleDice: string, exampleScore: number): ScoreHelp {
  return {
    title,
    what: `Count dice showing ${face}.`,
    score: `Sum of all ${face}s (count × ${face}). Scores 0 if none.`,
    example: `Dice ${exampleDice} → ${exampleScore}`,
  };
}

const sharedUpper: Partial<Record<Category, ScoreHelp>> = {
  ones: upperHelp(1, "Ones", "1-1-1-2-3", 3),
  twos: upperHelp(2, "Twos", "2-2-2-1-3", 6),
  threes: upperHelp(3, "Threes", "3-3-3-1-2", 9),
  fours: upperHelp(4, "Fours", "4-4-4-1-2", 12),
  fives: upperHelp(5, "Fives", "5-5-5-1-2", 15),
  sixes: upperHelp(6, "Sixes", "6-6-6-1-2", 18),
  chance: {
    title: "Chance",
    what: "Any dice combination.",
    score: "Sum of all five dice.",
    example: "Dice 2-3-4-5-6 → 20",
  },
};

const yatzyOnly: Partial<Record<Category, ScoreHelp>> = {
  one_pair: {
    title: "One pair",
    what: "At least two dice of the same face.",
    score: "Highest pair face × 2. Scores 0 if no pair.",
    example: "Dice 6-6-4-3-2 → 12",
  },
  two_pairs: {
    title: "Two pairs",
    what: "Two different pairs.",
    score: "Sum of both pair faces × 2 each. Scores 0 unless two pairs.",
    example: "Dice 6-6-5-5-2 → 22",
  },
  three_kind: {
    title: "Three of a kind",
    what: "At least three dice of the same face.",
    score: "That face × 3. Scores 0 if no three-of-a-kind.",
    example: "Dice 4-4-4-2-1 → 12",
  },
  four_kind: {
    title: "Four of a kind",
    what: "At least four dice of the same face.",
    score: "That face × 4. Scores 0 if no four-of-a-kind.",
    example: "Dice 3-3-3-3-6 → 12",
  },
  small_straight: {
    title: "Small straight",
    what: "Exactly 1-2-3-4-5 (all five dice).",
    score: "Scores 15, otherwise 0.",
    example: "Dice 1-2-3-4-5 → 15",
  },
  large_straight: {
    title: "Large straight",
    what: "Exactly 2-3-4-5-6 (all five dice).",
    score: "Scores 20, otherwise 0.",
    example: "Dice 2-3-4-5-6 → 20",
  },
  full_house: {
    title: "Full house",
    what: "Three of one face and two of another.",
    score: "Sum of all five dice. Scores 0 if not a full house.",
    example: "Dice 3-3-3-2-2 → 13",
  },
  yatzy: {
    title: "Yatzy",
    what: "All five dice the same face.",
    score: "Scores 50, otherwise 0.",
    example: "Dice 6-6-6-6-6 → 50",
  },
};

const yahtzeeOnly: Partial<Record<Category, ScoreHelp>> = {
  three_kind: {
    title: "Three of a kind",
    what: "At least three dice of the same face.",
    score: "Sum of all five dice. Scores 0 if no three-of-a-kind.",
    example: "Dice 4-4-4-2-1 → 15",
  },
  four_kind: {
    title: "Four of a kind",
    what: "At least four dice of the same face.",
    score: "Sum of all five dice. Scores 0 if no four-of-a-kind.",
    example: "Dice 3-3-3-3-6 → 18",
  },
  small_straight: {
    title: "Small straight",
    what: "Any sequence of four consecutive faces (1-4, 2-5, or 3-6).",
    score: "Scores 30, otherwise 0.",
    example: "Dice 1-2-3-4-6 → 30",
  },
  large_straight: {
    title: "Large straight",
    what: "1-2-3-4-5 or 2-3-4-5-6.",
    score: "Scores 40, otherwise 0.",
    example: "Dice 1-2-3-4-5 → 40",
  },
  full_house: {
    title: "Full house",
    what: "Three of one face and two of another.",
    score: "Scores 25, otherwise 0.",
    example: "Dice 3-3-3-2-2 → 25",
  },
  yahtzee: {
    title: "Yahtzee",
    what: "All five dice the same face.",
    score: "Scores 50, otherwise 0.",
    example: "Dice 6-6-6-6-6 → 50",
  },
};

const footers: Record<"upper_total" | "bonus" | "total", ScoreHelp> = {
  upper_total: {
    title: "Upper total",
    what: "Sum of Ones through Sixes only.",
    score: "Does not include lower-section categories or the bonus.",
    example: "Ones 3 + Twos 6 + Threes 9 + Fours 12 + Fives 15 + Sixes 18 = 63",
  },
  bonus: {
    title: "Bonus",
    what: "Awarded from the upper section total.",
    score: "If upper total ≥ 63, score 35; otherwise 0.",
    example: "Upper 63 → bonus 35; upper 62 → bonus 0",
  },
  total: {
    title: "Total",
    what: "Grand score for the player.",
    score: "Sum of all filled category scores plus the bonus.",
    example: "Categories 180 + bonus 35 → 215",
  },
};

function categoryHelp(ruleset: Ruleset, category: Category): ScoreHelp {
  const fromShared = sharedUpper[category];
  if (fromShared) return fromShared;

  const fromRuleset = ruleset === "yatzy" ? yatzyOnly[category] : yahtzeeOnly[category];
  if (fromRuleset) return fromRuleset;

  throw new Error(`No score help for ${ruleset}:${category}`);
}

export function getScoreHelp(ruleset: Ruleset, key: ScoreHelpKey): ScoreHelp {
  if (key === "upper_total" || key === "bonus" || key === "total") {
    return footers[key];
  }

  const allowed = ruleset === "yatzy" ? yatzyCategories : yahtzeeCategories;
  if (!(allowed as string[]).includes(key)) {
    throw new Error(`Category ${key} is not valid for ruleset ${ruleset}`);
  }

  return categoryHelp(ruleset, key);
}
