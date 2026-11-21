/** A deterministic source of numbers in `[0, 1)`. */
export type Rng = () => number;

/**
 * mulberry32: small, seedable, and identical on every platform, which is what
 * makes a failing generated game reproducible from its seed alone.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Adapts an `Rng` to the `randomInt` a module receives. Clamped, because a
 * module asking for a die faces worse behaviour from an out-of-range draw than
 * from a slightly biased one.
 */
export function randomIntFrom(rng: Rng): (maxExclusive: number) => number {
  return (maxExclusive: number) => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`randomInt needs a positive integer bound, got ${String(maxExclusive)}`);
    }
    return Math.min(maxExclusive - 1, Math.floor(rng() * maxExclusive));
  };
}

/** Uniform pick from a non-empty list. Used by fixtures that must choose an intent. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick needs at least one item");
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))] as T;
}
