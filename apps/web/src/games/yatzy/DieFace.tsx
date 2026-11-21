export type DieFaceVariant = "soft" | "classic";

type DieFaceProps = {
  value: number;
  variant?: DieFaceVariant;
  className?: string;
};

/** Standard die pip positions in a 3×3 grid (row-major indices 0–8). */
const PIP_LAYOUT: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function DieFace(props: DieFaceProps) {
  const variant = props.variant ?? "soft";
  const clamped = Number.isFinite(props.value)
    ? Math.max(0, Math.min(6, Math.trunc(props.value)))
    : 0;
  const pips = PIP_LAYOUT[clamped] ?? [];

  return (
    <span
      data-testid="die-face"
      data-value={clamped}
      data-variant={variant}
      aria-hidden="true"
      className={[
        "die-face grid h-full w-full grid-cols-3 grid-rows-3 place-items-center gap-0.5 p-[18%]",
        variant === "soft"
          ? "die-face--soft rounded-[1.1rem] bg-[linear-gradient(145deg,#ffffff_0%,#f1f5f9_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_6px_rgba(26,26,26,0.08)]"
          : "rounded-[1.1rem]",
        props.className ?? "",
      ].join(" ")}
    >
      {Array.from({ length: 9 }, (_, index) => {
        const active = pips.includes(index);
        const pipId = `pip-${index}`;
        return (
          <span
            key={pipId}
            data-pip={active ? "" : undefined}
            className={
              active
                ? "block size-[22%] min-h-1.5 min-w-1.5 rounded-full bg-[var(--color-ink)] shadow-[0_1px_1px_rgba(0,0,0,0.15)]"
                : "block size-[22%] min-h-1.5 min-w-1.5"
            }
          />
        );
      })}
    </span>
  );
}
