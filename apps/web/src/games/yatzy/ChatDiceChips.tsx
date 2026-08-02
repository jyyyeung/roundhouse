type ChatDiceChipsProps = {
  dice: number[];
  holds: boolean[];
};

function chipLabel(dice: number[], holds: boolean[]) {
  const values = dice.join(", ");
  const held = dice
    .map((_, index) => (holds[index] ? index + 1 : null))
    .filter((index): index is number => index !== null);

  if (held.length === 0) return `Dice ${values}`;
  return `Dice ${values}; held ${held.join(", ")}`;
}

export function ChatDiceChips(props: ChatDiceChipsProps) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label={chipLabel(props.dice, props.holds)}>
      {props.dice.map((value, index) => {
        const held = props.holds[index] === true;

        return (
          <span
            key={index}
            data-chip=""
            data-held={held ? "" : undefined}
            aria-hidden="true"
            className={[
              "inline-grid size-[22px] place-items-center rounded-md border-[1.5px] font-display text-xs font-semibold text-[var(--color-ink)]",
              held
                ? "border-[var(--color-teal-deep)] bg-[var(--color-teal)]"
                : "border-slate-200 bg-white",
            ].join(" ")}
          >
            {value}
          </span>
        );
      })}
    </div>
  );
}
