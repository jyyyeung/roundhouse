import type { YatzyView } from "@roundhouse/game-yatzy";

import type { GameSummary, SummaryLine } from "../../lib/summary";
import { categoriesFor, formatCategory, totalScore } from "./model";

/**
 * Yatzy's ending, in the platform's words.
 *
 * Everything here is read from the published view — totals are the same
 * `totalScore` the board renders, a round is one scored category per player, and
 * the best category is the highest single cell. No event log, no server call.
 */
export function summarizeYatzy(view: YatzyView): GameSummary | null {
  if (view.phase !== "finished") return null;

  const categories = categoriesFor(view.ruleset);

  const standings = view.playerIds.map((playerId) => ({
    playerId,
    total: totalScore(view, playerId),
  }));

  const rounds = view.playerIds.reduce((most, playerId) => {
    const sheet = view.sheets[playerId];
    const scored = categories.filter((category) => typeof sheet?.[category] === "number").length;
    return Math.max(most, scored);
  }, 0);

  const lines: SummaryLine[] = [];
  const best = bestCategory(view, categories);
  if (best) {
    lines.push({
      label: "Best category",
      value: `${formatCategory(best.category)} — ${best.score}`,
    });
  }

  // The upper-section bonus is the one rule players talk about afterwards, so it
  // is worth a line — but only when someone actually earned it.
  const bonuses = view.playerIds.filter((playerId) => view.sheets[playerId]?.bonus === 35).length;
  if (bonuses > 0) {
    lines.push({
      label: "Bonus",
      value: bonuses === 1 ? "1 player broke 63" : `${bonuses} players broke 63`,
    });
  }

  return { lines, rounds, standings, winners: view.winnerIds };
}

/**
 * The highest single category score in the game, with the category it came from.
 * Ties resolve by the game's own category order so the same game always reads
 * the same way.
 */
function bestCategory(view: YatzyView, categories: readonly string[]) {
  let best: { category: string; score: number } | null = null;

  for (const playerId of view.playerIds) {
    const sheet = view.sheets[playerId];
    for (const category of categories) {
      const score = sheet?.[category];
      if (score === null || score === undefined || score <= 0) continue;
      if (!best || score > best.score) best = { category, score };
    }
  }

  return best;
}
