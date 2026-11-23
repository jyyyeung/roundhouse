import { useState } from "react";
import {
  type GameSummary as GameSummaryData,
  playerLabel,
  rankStandings,
  summaryText,
  winnerHeadline,
} from "../lib/summary";
import {
  canRenderSummaryImage,
  downloadSummaryImage,
  renderSummaryImage,
} from "../lib/summary-image";

export type GameSummaryProps = {
  /** The table's display name, e.g. "Riverside Yatzy". */
  title: string;
  summary: GameSummaryData;
  /** Seat labels for the ids in the summary; the same map the board uses. */
  labels: Record<string, string>;
};

/**
 * A finished game, after the fact.
 *
 * It renders whatever `GameSummary` it is given and knows nothing about yatzy or
 * duel: the ranking is the standings sorted, the headline is the winners, and a
 * game that publishes no totals drops the ranking instead of breaking the card.
 *
 * The image is drawn locally (no dependency, no server round trip), and the same
 * text is always present for copy and for a reader that cannot see the picture.
 */
export function GameSummaryCard(props: GameSummaryProps) {
  const [canSave] = useState(() => canRenderSummaryImage());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "unavailable">("idle");
  const [copied, setCopied] = useState(false);

  const text = summaryText(props);
  const ranked = rankStandings(props.summary.standings);
  const headline = winnerHeadline(props.summary, props.labels);
  const headingId = "game-summary-headline";

  async function handleSave() {
    setSaveState("saving");
    const blob = await renderSummaryImage(props);
    if (!blob) {
      setSaveState("unavailable");
      return;
    }
    downloadSummaryImage(blob, imageFilename(props.title));
    setSaveState("saved");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // No clipboard permission (or no clipboard at all): the text stays on
      // screen below, which is the fallback rather than an error.
      setCopied(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="game-summary"
      className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur md:p-6"
    >
      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--color-coral)]">
        Final scores
      </p>
      <h2
        id={headingId}
        data-testid="game-summary-headline"
        className="mt-2 font-display text-3xl text-[var(--color-ink)]"
      >
        {headline}
      </h2>

      {ranked.length > 0 ? (
        <ol data-testid="game-summary-standings" className="mt-4 grid gap-2">
          {ranked.map((standing, index) => (
            <li
              key={standing.playerId}
              className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--color-cream)] px-4 py-3"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-[var(--color-ink)]"
                >
                  {index + 1}
                </span>
                <span className="truncate font-semibold text-[var(--color-ink)]">
                  {playerLabel(props.labels, standing.playerId)}
                </span>
              </span>
              <span className="font-display text-xl text-[var(--color-ink)]">{standing.total}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {props.summary.rounds !== undefined ? (
        <p data-testid="game-summary-rounds" className="mt-3 text-sm font-medium text-slate-600">
          {props.summary.rounds} rounds
        </p>
      ) : null}

      {props.summary.lines?.length ? (
        <dl data-testid="game-summary-lines" className="mt-3 grid gap-1 text-sm text-slate-700">
          {props.summary.lines.map((line) => (
            <div key={line.label} className="flex flex-wrap items-baseline gap-2">
              <dt className="font-semibold text-[var(--color-ink)]">{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* The whole card as text: what a screen reader gets and what "Copy" sends. */}
      <p data-testid="game-summary-text" className="sr-only">
        {text}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {canSave ? (
          <button
            type="button"
            className="rounded-2xl bg-[var(--color-ink)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            onClick={handleSave}
            disabled={saveState === "saving"}
          >
            {saveState === "saved" ? "Saved" : saveState === "saving" ? "Drawing..." : "Save image"}
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[var(--color-ink)]"
          onClick={handleCopy}
        >
          {copied ? "Copied" : "Copy summary"}
        </button>
      </div>

      {saveState === "unavailable" ? (
        <p role="alert" className="mt-3 text-sm font-medium text-rose-700">
          This browser cannot draw the image — the summary text is below.
        </p>
      ) : null}

      {canSave ? null : (
        <pre
          data-testid="game-summary-fallback"
          className="mt-4 overflow-x-auto rounded-2xl bg-[var(--color-cream)] p-4 text-sm whitespace-pre-wrap text-slate-700"
        >
          {text}
        </pre>
      )}
    </section>
  );
}

/** `Riverside Yatzy` → `riverside-yatzy-result.png`; never an empty name. */
function imageFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "roundhouse"}-result.png`;
}
