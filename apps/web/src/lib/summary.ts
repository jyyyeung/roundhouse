/**
 * A finished game, said in a shape any game can produce.
 *
 * The card, the PNG and the copyable text all render this and nothing else, so
 * no platform file learns a game's internals: a game builds a `GameSummary` from
 * its own projection (see `apps/web/src/games/<game>/summary.ts`) and the rest
 * of the app treats every game's ending the same way.
 *
 * Nothing here is required. A game that publishes no totals simply leaves
 * `standings` empty and the card drops the ranking section.
 */
export type SummaryLine = { label: string; value: string };

export type SummaryStanding = { playerId: string; total: number };

export type GameSummary = {
  /** Player ids, in the game's own order. Empty when nobody won (a draw). */
  winners: string[];
  /** Unranked on purpose: `rankStandings` decides the order exactly once. */
  standings: SummaryStanding[];
  /** How long the game took, in the game's own unit. Omitted when unknown. */
  rounds?: number;
  /** One or two sharper facts, e.g. "Best category — Fives 20". */
  lines?: SummaryLine[];
};

/** Highest total first; ties keep the game's own order (sort is stable). */
export function rankStandings(standings: readonly SummaryStanding[]): SummaryStanding[] {
  return [...standings].sort((left, right) => right.total - left.total);
}

export function playerLabel(labels: Record<string, string>, playerId: string): string {
  return labels[playerId] ?? playerId;
}

/**
 * The one sentence the card is about. Also what a screen reader hears instead of
 * the visual ranking, so it names the winner rather than only the totals.
 */
export function winnerHeadline(summary: GameSummary, labels: Record<string, string>): string {
  const names = summary.winners.map((playerId) => playerLabel(labels, playerId));
  if (names.length === 0) return "A draw";
  if (names.length === 1) return `${names[0]} wins`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} tie`;
}

/**
 * The card as plain text: the sr-only copy, the clipboard payload and the
 * canvas layout are all this list, so the three cannot drift apart.
 */
export function summaryTextLines(options: {
  title: string;
  summary: GameSummary;
  labels: Record<string, string>;
}): string[] {
  const { title, summary, labels } = options;
  const lines = [`${title} — final scores`, winnerHeadline(summary, labels)];

  rankStandings(summary.standings).forEach((standing, index) => {
    lines.push(`${index + 1}. ${playerLabel(labels, standing.playerId)} — ${standing.total}`);
  });

  if (summary.rounds !== undefined) lines.push(`${summary.rounds} rounds`);

  for (const line of summary.lines ?? []) lines.push(`${line.label}: ${line.value}`);

  return lines;
}

export function summaryText(options: {
  title: string;
  summary: GameSummary;
  labels: Record<string, string>;
}): string {
  return summaryTextLines(options).join("\n");
}
