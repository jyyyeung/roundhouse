import {
  getScoreHelp,
  type ScoreHelp,
  type ScoreHelpKey,
  type YatzyView,
} from "@roundhouse/game-yatzy";
import { motion } from "motion/react";

import { InfoTip } from "../../ui/InfoTip";
import { categoriesFor, formatCategory, previewScore, totalScore, upperTotal } from "./model";

type ScoreSheetProps = {
  state: YatzyView;
  playerLabels: Record<string, string>;
  currentUserId: string | null;
  canScore: boolean;
  onScore: (category: string) => void;
};

function HelpBody(props: { help: ScoreHelp }) {
  return (
    <div className="space-y-1">
      <p className="font-semibold">{props.help.title}</p>
      <p>{props.help.what}</p>
      <p>{props.help.score}</p>
      <p className="text-slate-500">{props.help.example}</p>
    </div>
  );
}

function LabelWithHelp(props: {
  text: string;
  helpKey: ScoreHelpKey;
  ruleset: YatzyView["ruleset"];
}) {
  const help = getScoreHelp(props.ruleset, props.helpKey);
  return (
    <div className="flex items-center gap-1.5">
      <span>{props.text}</span>
      <InfoTip label={`About ${help.title}`}>
        <HelpBody help={help} />
      </InfoTip>
    </div>
  );
}

export function ScoreSheet(props: ScoreSheetProps) {
  const categories = categoriesFor(props.state.ruleset);

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-[0_20px_60px_rgba(26,26,26,0.1)] backdrop-blur md:h-full md:min-h-0 md:overflow-y-auto">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead className="bg-[var(--color-cream)] text-left">
            <tr>
              <th className="px-3 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-[var(--color-coral)]">
                Category
              </th>
              {props.state.playerIds.map((playerId) => (
                <th
                  key={playerId}
                  className="px-3 py-2 text-sm font-semibold text-[var(--color-ink)]"
                >
                  {props.playerLabels[playerId] ?? playerId}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category} className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-sm font-semibold text-slate-700">
                  <LabelWithHelp
                    text={formatCategory(category)}
                    helpKey={category}
                    ruleset={props.state.ruleset}
                  />
                </td>
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
              <td className="px-3 py-2 text-sm font-semibold text-slate-700">
                <LabelWithHelp
                  text="Upper total"
                  helpKey="upper_total"
                  ruleset={props.state.ruleset}
                />
              </td>
              {props.state.playerIds.map((playerId) => (
                <td
                  key={`upper:${playerId}`}
                  className="px-3 py-2 text-sm font-semibold text-[var(--color-ink)]"
                >
                  {upperTotal(props.state.sheets[playerId] ?? {})}
                </td>
              ))}
            </tr>
            <tr className="border-t border-slate-200 bg-slate-50/70">
              <td className="px-3 py-2 text-sm font-semibold text-slate-700">
                <LabelWithHelp text="Bonus" helpKey="bonus" ruleset={props.state.ruleset} />
              </td>
              {props.state.playerIds.map((playerId) => (
                <td
                  key={`bonus:${playerId}`}
                  className="px-3 py-2 text-sm font-semibold text-[var(--color-ink)]"
                >
                  {props.state.sheets[playerId]?.bonus ?? "-"}
                </td>
              ))}
            </tr>
            <tr className="border-t border-slate-200 bg-slate-100/80">
              <td className="px-3 py-2 text-sm font-semibold text-slate-700">
                <LabelWithHelp text="Total" helpKey="total" ruleset={props.state.ruleset} />
              </td>
              {props.state.playerIds.map((playerId) => (
                <td
                  key={`total:${playerId}`}
                  className="px-3 py-2 text-sm font-bold text-[var(--color-ink)]"
                >
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
