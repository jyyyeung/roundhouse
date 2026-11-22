/**
 * A sliding-window rate limiter, shared by every input that a client can drive
 * in a loop: chat messages, game intents and (via `client-ip.ts`) auth attempts.
 *
 * Sliding window rather than fixed buckets on purpose: a fixed window lets a
 * client spend the full budget at the end of one bucket and again at the start
 * of the next, which is double the limit for free.
 *
 * State is in-process memory, so the budget is per server process. Two replicas
 * would each allow the full budget; that limit is stated in the README rather
 * than papered over with a shared store the deployment does not have yet.
 */

export type LimiterDecision = { ok: true } | { ok: false; retryAfterMs: number };

export type Limiter = {
  /** Charge one call against `key`, or report how long to wait. */
  take(key: string): LimiterDecision;
  /** Keys currently tracked. Exposed for tests and for the periodic prune. */
  size(): number;
};

export type LimiterOptions = {
  /** Calls allowed per window. */
  limit: number;
  windowMs: number;
  /** Injected clock so tests do not sleep. */
  now?: () => number;
};

/**
 * A key is forgotten once its newest call is older than the window, so an
 * abandoned table or a one-off visitor does not hold memory forever. The sweep
 * costs one pass over the map, so it runs every `pruneEvery` calls instead of on
 * every call.
 */
const pruneEvery = (limit: number) => Math.max(64, limit * 4);

export function createLimiter(options: LimiterOptions): Limiter {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const every = pruneEvery(limit);
  let callsSincePrune = 0;

  function prune(at: number) {
    for (const [key, timestamps] of hits) {
      const live = timestamps.filter((timestamp) => at - timestamp < windowMs);
      if (live.length === 0) {
        hits.delete(key);
        continue;
      }
      hits.set(key, live);
    }
  }

  return {
    take(key) {
      const at = now();
      callsSincePrune += 1;
      if (callsSincePrune >= every) {
        callsSincePrune = 0;
        prune(at);
      }

      const live = (hits.get(key) ?? []).filter((timestamp) => at - timestamp < windowMs);
      if (live.length >= limit) {
        hits.set(key, live);
        // The oldest call still inside the window is the one whose expiry frees
        // a slot, so waiting that long always buys at least one call.
        const oldest = live[0] ?? at;
        return { ok: false, retryAfterMs: Math.max(1, windowMs - (at - oldest)) };
      }

      live.push(at);
      hits.set(key, live);
      return { ok: true };
    },
    size() {
      return hits.size;
    },
  };
}
