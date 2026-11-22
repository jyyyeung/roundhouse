/**
 * Sound and haptics for the four moments a table has something to say: a roll, a
 * hold, a score, and the end of a game.
 *
 * Deliberate choices:
 *
 * - **Silent until asked.** Sound is off by default and the choice persists.
 *   A page that makes noise before the player asked is a worse first impression
 *   than a quiet one, and on a phone it is often the wrong moment entirely.
 * - **No assets, no dependency.** One `AudioContext` oscillator envelope per
 *   tone; nothing to download and nothing to keep in sync.
 * - **No-ops everywhere it cannot work.** jsdom has no `AudioContext`, a browser
 *   may have no `navigator.vibrate`, and `prefers-reduced-motion: reduce` means
 *   the player asked for calm — all three play nothing instead of throwing.
 * - **Called by the view, not the wire.** Feedback is derived from the projected
 *   state the game view already renders, so no game has to emit an event for it
 *   and the server never learns whether a phone buzzed.
 */

export type FeedbackKind = "roll" | "hold" | "score" | "win";

const STORAGE_KEY = "roundhouse:sound";

type Tone = {
  /** Milliseconds of vibration; the pattern a phone should feel. */
  haptics: number | number[];
  /** Oscillator frequencies in Hz, played one after another. */
  notes: number[];
  /** How long each note lasts, in seconds. */
  noteSeconds: number;
};

const TONES: Record<FeedbackKind, Tone> = {
  hold: { haptics: 5, notes: [520], noteSeconds: 0.05 },
  roll: { haptics: 8, notes: [300, 360], noteSeconds: 0.05 },
  score: { haptics: 12, notes: [640], noteSeconds: 0.09 },
  win: { haptics: [12, 40, 12], notes: [520, 660, 880], noteSeconds: 0.11 },
};

const listeners = new Set<() => void>();

/** `localStorage` throws in private modes and is absent under jsdom's defaults. */
function readStored(): boolean | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (value === "on") return true;
    if (value === "off") return false;
    return null;
  } catch {
    return null;
  }
}

let enabled = readStored() ?? false;

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // A browser that refuses storage still gets the toggle for this session.
  }
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`: the header button and any view share one value. */
export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget the persisted choice, back to the silent default. */
export function resetSoundPreference(): void {
  enabled = false;
  listeners.clear();
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type AudioContextLike = {
  close: () => Promise<void> | void;
  createGain: () => {
    connect: (node: unknown) => void;
    gain: {
      exponentialRampToValueAtTime: (value: number, at: number) => void;
      setValueAtTime: (value: number, at: number) => void;
    };
  };
  createOscillator: () => {
    connect: (node: unknown) => void;
    frequency: { setValueAtTime: (value: number, at: number) => void };
    start: (at: number) => void;
    stop: (at: number) => void;
    type: string;
  };
  currentTime: number;
  destination: unknown;
  state?: string;
};

type AudioContextConstructor = new () => AudioContextLike;

let context: AudioContextLike | null = null;

function audioContext(): AudioContextLike | null {
  if (context) return context;
  const candidate = (globalThis as { AudioContext?: AudioContextConstructor }).AudioContext;
  if (typeof candidate !== "function") return null;
  try {
    context = new candidate();
    return context;
  } catch {
    return null;
  }
}

function playTone(kind: FeedbackKind): void {
  const audio = audioContext();
  if (!audio) return;
  const tone = TONES[kind];
  // A browser suspends the context until a gesture; every call here follows one.
  if (audio.state === "suspended")
    void (audio as unknown as { resume: () => Promise<void> }).resume?.();

  tone.notes.forEach((frequency, index) => {
    const at = audio.currentTime + index * tone.noteSeconds;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.08, at + tone.noteSeconds * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.noteSeconds);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + tone.noteSeconds);
  });
}

function buzz(kind: FeedbackKind): void {
  const vibrate = (
    globalThis.navigator as { vibrate?: (pattern: number | number[]) => boolean } | undefined
  )?.vibrate;
  if (typeof vibrate !== "function") return;
  try {
    vibrate(TONES[kind].haptics);
  } catch {
    // Vibration is a nicety; a refusal here must never break a turn.
  }
}

/** Play one moment. Silent when muted, reduced-motion, or unsupported. */
export function playFeedback(kind: FeedbackKind): void {
  if (!enabled) return;
  if (prefersReducedMotion()) return;
  try {
    playTone(kind);
    buzz(kind);
  } catch {
    // Feedback must never be the reason a move looks like it failed.
  }
}

/** The object a view imports; functions stay individually testable. */
export const feedback = {
  isEnabled: isSoundEnabled,
  play: playFeedback,
  setEnabled: setSoundEnabled,
  subscribe: subscribeSound,
};
