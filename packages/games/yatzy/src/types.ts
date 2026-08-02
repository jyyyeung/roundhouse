export type Ruleset = "yatzy" | "yahtzee";
export type Dice = [number, number, number, number, number];

export type Upper = "ones" | "twos" | "threes" | "fours" | "fives" | "sixes";

export type YatzyCategory =
  | Upper
  | "one_pair"
  | "two_pairs"
  | "three_kind"
  | "four_kind"
  | "small_straight"
  | "large_straight"
  | "full_house"
  | "chance"
  | "yatzy";

export type YahtzeeCategory =
  | Upper
  | "three_kind"
  | "four_kind"
  | "full_house"
  | "small_straight"
  | "large_straight"
  | "yahtzee"
  | "chance";

export type Category = YatzyCategory | YahtzeeCategory;
