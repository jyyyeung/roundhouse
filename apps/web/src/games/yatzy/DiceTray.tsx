import { motion } from "motion/react";

type DiceTrayProps = {
  dice: number[];
  holds: boolean[];
  rollsLeft: number;
  canRoll: boolean;
  canToggleHolds: boolean;
  rollVersion: number;
  onToggleHold: (index: number) => void;
  onRoll: () => void;
};

const DIE_FACES = ["-", "I", "II", "III", "IV", "V", "VI"];

export function DiceTray(props: DiceTrayProps) {
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.1)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--color-coral)]">Dice tray</p>
          <p className="mt-2 text-sm text-slate-600">{props.rollsLeft} rolls left</p>
        </div>
        <motion.button
          type="button"
          className="rounded-2xl bg-[var(--color-ink)] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          whileTap={props.canRoll ? { scale: 0.96 } : undefined}
          onClick={props.onRoll}
          disabled={!props.canRoll}
        >
          Roll dice
        </motion.button>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-3">
        {props.dice.map((value, index) => {
          const held = props.holds[index];

          return (
            <motion.button
              key={index}
              type="button"
              layout
              className={[
                "aspect-square rounded-[1.4rem] border px-0 text-center font-display text-3xl shadow-sm transition",
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
              {DIE_FACES[value] ?? value}
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
