import { motion } from "motion/react";
import type { YatzyState } from "@roundhouse/game-yatzy";

import { categoriesFor, formatCategory, previewScore, totalScore, upperTotal } from "./model";

type ScoreSheetProps = {
  state: YatzyState;
  playerLabels: Record<string, string>;
  currentUserId: string | null;
  canScore: boolean;
  onScore: (category: string) => void;
};

export function ScoreSheet(props: ScoreSheetProps) {
  const categories = categoriesFor(props.state.ruleset);

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-[0_20px_60px_rgba(26,26,26,0.1)] backdrop-blur md:h-full md:min-h-0 md:overflow-y-auto">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead className="bg-[var(--color-cream)] text-left">
            <tr>
              <th className="px-3 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-[var(--color-coral)]">Category</th>
              {props.state.playerIds.map((playerId) => (
                <th key={playerId} className="px-3 py-2 text-sm font-semibold text-[var(--color-ink)]">
                  {props.playerLabels[playerId] ?? playerId}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category} className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-sm font-semibold text-slate-700">{formatCategory(category)}</td>
                {props.state.playerIds.map((playerId) => {
                  const sheet = props.state.sheets[playerId];
                  const value = sheet?.[category] ?? null;
                  const isSelf = playerId === props.currentUserId;
                  const isClickable = isSelf && props.canScore && value === null;
                  const preview = isClickable ? previewScore(props.state, category) : null;
                  const display =
                    value !== null ? value : isClickable && preview !== null ? preview : "—";

                  return (
                    <td key={`${category}:${playerId}`} className="px-2 py-2">
                      <motion.button
                        type="button"
                        layout
                        className={[
                          "w-full rounded-2xl px-3 py-2 text-left text-sm transition",
                          value !== null
                            ? "bg-slate-50 font-semibold text-[var(--color-ink)]"
                            : isClickable
                              ? "bg-[var(--color-teal)]/70 text-[var(--color-ink)]"
                              : "bg-white text-slate-400",
                        ].join(" ")}
                        animate={value !== null ? { scale: [1, 1.03, 1] } : { scale: 1 }}
                        transition={{ duration: 0.25 }}
                        whileTap={isClickable ? { scale: 0.97 } : undefined}
                        onClick={() => props.onScore(category)}
                        disabled={!isClickable}
                        aria-label={
                          value !== null
                            ? `${formatCategory(category)} ${value}`
                            : preview !== null && isClickable
                              ? `Score ${formatCategory(category)} — ${preview}`
                              : `Score ${formatCategory(category)}`
                        }
                      >
                        <span className="block font-semibold">{display}</span>
                      </motion.button>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-slate-50/70">
              <td className="px-3 py-2 text-sm font-semibold text-slate-700">Upper total</td>
              {props.state.playerIds.map((playerId) => (
                <td key={`upper:${playerId}`} className="px-3 py-2 text-sm font-semibold text-[var(--color-ink)]">
                  {upperTotal(props.state.sheets[playerId] ?? {})}
                </td>
              ))}
            </tr>
            <tr className="border-t border-slate-200 bg-slate-50/70">
              <td className="px-3 py-2 text-sm font-semibold text-slate-700">Bonus</td>
              {props.state.playerIds.map((playerId) => (
                <td key={`bonus:${playerId}`} className="px-3 py-2 text-sm font-semibold text-[var(--color-ink)]">
                  {props.state.sheets[playerId]?.bonus ?? "-"}
                </td>
              ))}
            </tr>
            <tr className="border-t border-slate-200 bg-slate-100/80">
              <td className="px-3 py-2 text-sm font-semibold text-slate-700">Total</td>
              {props.state.playerIds.map((playerId) => (
                <td key={`total:${playerId}`} className="px-3 py-2 text-sm font-bold text-[var(--color-ink)]">
                  {totalScore(props.state, playerId)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
