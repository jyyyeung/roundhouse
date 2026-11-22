import { getTurnHelp } from "@roundhouse/game-yatzy";
import { motion } from "motion/react";
import { InfoTip } from "../../ui/InfoTip";

import { DieFace } from "./DieFace";

type DiceTrayProps = {
  dice: number[];
  holds: boolean[];
  rollsLeft: number;
  canRoll: boolean;
  canToggleHolds: boolean;
  rollVersion: number;
  onToggleHold: (index: number) => void;
  onRoll: () => void;
  /**
   * A replay shows the tray without offering it. The dice must stay visible —
   * they are the whole story of a turn — but a control that cannot act is a
   * promise the table cannot keep, so the roll button is absent and each die is
   * a picture rather than a button.
   */
  readOnly?: boolean;
};

export function DiceTray(props: DiceTrayProps) {
  const turnHelp = getTurnHelp();

  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.1)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--color-coral)]">
              Dice tray
            </p>
            <InfoTip label="About the dice tray">
              <div className="space-y-1">
                <p className="font-semibold">{turnHelp.title}</p>
                {turnHelp.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </InfoTip>
          </div>
          <p className="mt-2 text-sm text-slate-600">{props.rollsLeft} rolls left</p>
        </div>
        {props.readOnly ? null : (
          <motion.button
            type="button"
            className="rounded-2xl bg-[var(--color-ink)] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            whileTap={props.canRoll ? { scale: 0.96 } : undefined}
            onClick={props.onRoll}
            disabled={!props.canRoll}
          >
            Roll dice
          </motion.button>
        )}
      </div>

      <div className="dice-row mt-4 flex flex-wrap justify-center gap-3">
        {/* Each die is pinned to its slot, so the slot is its identity. */}
        {props.dice.map((value, index) => {
          const held = props.holds[index];
          // A die belongs to its slot, so the slot is the identity.
          const slotId = `die-${index}`;

          const className = [
            "size-12 overflow-hidden rounded-[1.4rem] border p-1.5 shadow-sm transition md:size-14",
            held
              ? "border-[var(--color-teal-deep)] bg-[var(--color-teal)] text-[var(--color-ink)]"
              : "border-slate-200 bg-white text-[var(--color-ink)]",
          ].join(" ");

          if (props.readOnly) {
            return (
              <div
                key={slotId}
                data-testid={`die-view-${index}`}
                className={className}
                role="img"
                aria-label={`Die ${index + 1}: ${value}`}
              >
                <DieFace value={value} />
              </div>
            );
          }

          return (
            <motion.button
              key={slotId}
              type="button"
              layout
              className={[
                "size-12 overflow-hidden rounded-[1.4rem] border p-1.5 shadow-sm transition md:size-14",
                held
                  ? "border-[var(--color-teal-deep)] bg-[var(--color-teal)] text-[var(--color-ink)]"
                  : "border-slate-200 bg-white text-[var(--color-ink)]",
              ].join(" ")}
              animate={{
                rotate: props.rollVersion > 0 ? [0, -8, 8, -5, 0] : 0,
                y: props.rollVersion > 0 ? [0, -6, 0] : 0,
                scale: held ? 1.04 : 1,
              }}
              transition={{ duration: 0.35, delay: index * 0.03 }}
              whileTap={props.canToggleHolds ? { scale: 0.94 } : undefined}
              onClick={() => props.onToggleHold(index)}
              disabled={!props.canToggleHolds}
              aria-pressed={held}
              aria-label={held ? `Release die ${index + 1}` : `Hold die ${index + 1}`}
            >
              <DieFace value={value} />
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
