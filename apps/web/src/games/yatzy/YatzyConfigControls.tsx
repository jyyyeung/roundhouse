import type { Json } from "@roundhouse/game-core";
import { getRulesetCompareHelp, type Ruleset } from "@roundhouse/game-yatzy";

import { InfoTip } from "../../ui/InfoTip";
import type { GameConfigControlsProps } from "../registry";

/**
 * The yatzy-specific half of the create-table form: which score card a table
 * plays. It is a component the game owns and the lobby renders, so the lobby
 * never learns what a ruleset is.
 */
export function YatzyConfigControls(props: GameConfigControlsProps) {
  const rulesetHelp = getRulesetCompareHelp();
  const ruleset = readRuleset(props.config);

  return (
    <div className="block">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <label htmlFor="create-ruleset">Ruleset</label>
        <InfoTip label="About rulesets">
          <div className="space-y-1">
            <p className="font-semibold">{rulesetHelp.title}</p>
            {rulesetHelp.body.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </InfoTip>
      </div>
      <select
        id="create-ruleset"
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-[var(--color-ink)]"
        value={ruleset}
        onChange={(event) => props.onChange({ ruleset: event.target.value as Ruleset })}
      >
        <option value="yatzy">Yatzy</option>
        <option value="yahtzee">Yahtzee</option>
      </select>
    </div>
  );
}

/** Reads a ruleset out of an untrusted config, defaulting the way the server does. */
export function readRuleset(config: Json | undefined): Ruleset {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return config.ruleset === "yahtzee" ? "yahtzee" : "yatzy";
  }
  return "yatzy";
}

/** How a table of this game is named in the lobby list. */
export function yatzyTableTitle(config: Json | undefined): string {
  return readRuleset(config) === "yahtzee" ? "Yahtzee" : "Yatzy";
}
