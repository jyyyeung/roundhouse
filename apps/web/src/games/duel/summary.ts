import type { DuelRound, DuelView } from "@roundhouse/game-duel";

import type { GameSummary, SummaryLine } from "../../lib/summary";

/**
 * Duel's ending, in the platform's words.
 *
 * `scores` and `rounds` are already public in the projection, so the card needs
 * no new field: the streak is read off the round list, where a revealed round's
 * winner is the only thing that decides it.
 */
export function summarizeDuel(view: DuelView): GameSummary | null {
  if (view.phase !== "finished") return null;

  const standings = view.playerIds.map((playerId) => ({
    playerId,
    total: view.scores[playerId] ?? 0,
  }));

  const lines: SummaryLine[] = [];
  const streak = longestStreak(view.rounds);
  if (streak && streak.length > 1) {
    lines.push({ label: "Longest streak", value: `${streak.length} rounds` });
  }
  // A match that needed a decisive roll after the last round is worth saying out
  // loud: it is the story the group retells.
  if (view.decidedBy === "roll") {
    lines.push({ label: "Decided by", value: "a final roll" });
  }

  return { lines, rounds: view.rounds.length, standings, winners: view.winnerIds };
}

/** The longest run of rounds won by the same player; draws break it. */
function longestStreak(rounds: readonly DuelRound[]): { length: number; playerId: string } | null {
  let best: { length: number; playerId: string } | null = null;
  let current: { length: number; playerId: string } | null = null;

  for (const round of rounds) {
    if (round.winnerId === null) {
      current = null;
      continue;
    }
    current =
      current && current.playerId === round.winnerId
        ? { length: current.length + 1, playerId: round.winnerId }
        : { length: 1, playerId: round.winnerId };
    if (!best || current.length > best.length) best = current;
  }

  return best;
}
