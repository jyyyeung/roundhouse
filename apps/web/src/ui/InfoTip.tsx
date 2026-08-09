import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState, type ReactNode } from "react";

type InfoTipProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

function useFinePointer() {
  const [fine, setFine] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
      : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setFine(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return fine;
}

export function InfoTip(props: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const finePointer = useFinePointer();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearCloseTimer() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function openNow() {
    clearCloseTimer();
    setOpen(true);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  useEffect(() => () => clearCloseTimer(), []);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        aria-label={props.label}
        className={[
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[0.65rem] font-bold leading-none text-slate-500 transition hover:border-[var(--color-teal-deep)] hover:text-[var(--color-ink)]",
          props.className,
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={(event) => {
          if (finePointer) {
            // Hover mode owns open state; keep click from fighting focus/hover.
            event.preventDefault();
          }
        }}
        onPointerEnter={() => {
          if (finePointer) openNow();
        }}
        onPointerLeave={() => {
          if (finePointer) scheduleClose();
        }}
        onFocus={() => {
          if (finePointer) openNow();
        }}
        onBlur={() => {
          if (finePointer) scheduleClose();
        }}
      >
        ⓘ
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-xs rounded-2xl border border-white/80 bg-[var(--color-cream)] px-3 py-2 text-sm text-[var(--color-ink)] shadow-[0_12px_40px_rgba(26,26,26,0.16)] outline-none"
          onPointerEnter={() => {
            if (finePointer) openNow();
          }}
          onPointerLeave={() => {
            if (finePointer) scheduleClose();
          }}
          onOpenAutoFocus={(event) => {
            if (finePointer) event.preventDefault();
          }}
        >
          {props.children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
