import { useSyncExternalStore } from "react";

import { isSoundEnabled, setSoundEnabled, subscribeSound } from "../lib/feedback";

/**
 * The sound switch, in the table header.
 *
 * A real `<button>` with `aria-pressed`, so it is keyboard reachable and a screen
 * reader says whether sound is on. The value is shared with `feedback.play`
 * through one store, so toggling and playing can never disagree.
 */
export function SoundToggle() {
  const enabled = useSyncExternalStore(subscribeSound, isSoundEnabled, () => false);

  return (
    <button
      aria-label={enabled ? "Turn sound off" : "Turn sound on"}
      aria-pressed={enabled}
      className="rounded-2xl bg-white/80 px-4 py-3 font-semibold text-[var(--color-ink)] shadow-sm"
      onClick={() => setSoundEnabled(!enabled)}
      type="button"
    >
      <span aria-hidden="true">{enabled ? "🔊" : "🔈"}</span>
      <span className="ml-2">{enabled ? "Sound on" : "Sound off"}</span>
    </button>
  );
}
