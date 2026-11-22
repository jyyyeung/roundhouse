import type { Json, TableMeta } from "@roundhouse/game-core";
import type { DuelCard, DuelView } from "@roundhouse/game-duel";
import { useMemo } from "react";

export type DuelTableProps = {
  meta: TableMeta;
  state: DuelView;
  currentUserId: string | null;
  onlineUserIds: string[];
  onIntent: (type: string, payload: Json) => void;
  /** Replay shows a round that already resolved: picks are not available. */
  readOnly?: boolean;
};

/** Display order: the triangle read clockwise. */
const CARD_ORDER: DuelCard[] = ["strike", "guard", "feint"];

const CARD_LABEL: Record<DuelCard, string> = {
  feint: "Feint",
  guard: "Guard",
  strike: "Strike",
};

/**
 * The one thing a player needs to know about a card, in the game's own words:
 * which of the other two it beats. The relation lives here only as a label — the
 * server decides the round.
 */
const BEATS: Record<DuelCard, DuelCard> = {
  feint: "guard",
  guard: "strike",
  strike: "feint",
};

/**
 * Duel's table view. It renders exactly what `projectDuelView` published, which
 * is the point of the game: `yourPick` is present only when the card is yours,
 * so this component cannot accidentally draw a card it was not given.
 */
export function DuelTable(props: DuelTableProps) {
  const { state } = props;

  const playerLabels = useMemo(() => {
    return Object.fromEntries(
      props.meta.seatUserIds.map((playerId, index) => [
        playerId,
        playerId === props.currentUserId ? "You" : `Player ${index + 1}`,
      ]),
    ) as Record<string, string>;
  }, [props.currentUserId, props.meta.seatUserIds]);

  const label = (playerId: string | null) => {
    if (playerId === null) return "—";
    return playerLabels[playerId] ?? "Waiting";
  };

  const myId = state.you === null ? null : (state.playerIds[state.you] ?? null);
  const seated = myId !== null;
  const opponentId = state.playerIds.find((playerId) => playerId !== myId) ?? null;
  const waitingOn = state.playerIds.filter((playerId) => !state.pickedBy.includes(playerId));
  const finished = state.phase === "finished";
  const canPick = !props.readOnly && seated && !finished && state.yourPick === null;

  const headline = finished
    ? state.winnerIds.length > 0
      ? `${label(state.winnerIds[0] ?? null)} wins`
      : "Level match"
    : `Round ${state.round} of ${state.totalRounds}`;

  const helper = finished
    ? state.decidedBy === "roll"
      ? "The scores were level, so the server drew a card for each of you."
      : "Final scores."
    : !seated
      ? "You are watching this duel. Both picks stay secret until the round resolves."
      : state.yourPick !== null
        ? `You played ${CARD_LABEL[state.yourPick]}. Waiting for ${waitingOn.map(label).join(", ") || "the round"}.`
        : "Both players pick in secret at the same time. Neither card is revealed until you both have.";

  function play(card: DuelCard) {
    props.onIntent("play", { card });
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-[2rem] bg-[linear-gradient(135deg,var(--color-ink),var(--color-coral))] p-5 text-white shadow-[0_20px_50px_rgba(26,26,26,0.28)] md:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/75">Duel</p>
        <h1 className="mt-2 font-display text-2xl leading-none md:text-4xl">{headline}</h1>
        <p className="mt-3 max-w-prose text-sm text-white/85">{helper}</p>

        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {state.playerIds.map((playerId) => {
            const picked = state.pickedBy.includes(playerId);
            const isYou = playerId === myId;

            return (
              <li
                key={playerId}
                className={[
                  "flex items-center justify-between gap-3 rounded-2xl px-4 py-3",
                  isYou ? "bg-white/20" : "bg-white/10",
                ].join(" ")}
              >
                <span className="min-w-0 truncate text-sm font-semibold">
                  {label(playerId)}
                  {isYou ? " (you)" : ""}
                </span>
                <span className="flex shrink-0 items-center gap-3 text-sm">
                  <span className="text-white/75">
                    {finished ? "" : picked ? "picked" : "thinking"}
                  </span>
                  <span className="font-display text-xl">{state.scores[playerId] ?? 0}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur md:p-6">
        <h2 className="font-display text-xl text-[var(--color-ink)]">Pick a card</h2>
        <p className="mt-1 text-sm text-slate-600">
          {props.readOnly
            ? "A replay of a finished duel. Nothing here can change the result."
            : finished
              ? "This duel is over. Start a rematch from the table header to play again."
              : canPick
                ? "Choose now — your opponent will not see it until the round resolves."
                : "You have already played this round."}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {CARD_ORDER.map((card) => (
            <button
              key={card}
              type="button"
              disabled={!canPick}
              onClick={() => play(card)}
              className={[
                "rounded-3xl border p-4 text-left transition",
                state.yourPick === card
                  ? "border-[var(--color-coral)] bg-[var(--color-coral)] text-white"
                  : "border-slate-200 bg-white text-[var(--color-ink)]",
                canPick ? "hover:-translate-y-0.5 hover:border-[var(--color-coral)]" : "opacity-60",
              ].join(" ")}
            >
              <span className="block font-display text-lg">{CARD_LABEL[card]}</span>
              <span className="mt-1 block text-xs uppercase tracking-[0.18em] opacity-70">
                beats {CARD_LABEL[BEATS[card]]}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur md:p-6">
        <h2 className="font-display text-xl text-[var(--color-ink)]">Rounds</h2>
        {state.rounds.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            Nothing revealed yet. The first round resolves when both of you have picked.
          </p>
        ) : (
          <ol className="mt-3 grid gap-2">
            {[...state.rounds].reverse().map((round) => (
              <li
                key={round.round}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm"
              >
                <span className="font-semibold text-[var(--color-ink)]">Round {round.round}</span>
                <span className="text-slate-600">
                  {round.plays
                    .map((entry) => `${label(entry.playerId)}: ${CARD_LABEL[entry.card]}`)
                    .join(" · ")}
                </span>
                <span className="font-semibold text-[var(--color-coral)]">
                  {round.winnerId === null ? "Clash — no point" : `${label(round.winnerId)} +1`}
                </span>
              </li>
            ))}
          </ol>
        )}

        {finished && opponentId !== null ? (
          <p className="mt-4 text-sm text-slate-600">
            Final: {label(myId)} {state.scores[myId ?? ""] ?? 0} — {label(opponentId)}{" "}
            {state.scores[opponentId] ?? 0}
          </p>
        ) : null}
      </section>
    </div>
  );
}
