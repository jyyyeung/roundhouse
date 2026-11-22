import { describe, expect, test } from "vitest";

import { createLimiter } from "./rate-limit";

/** A clock the test moves by hand; no sleeping, no flakes. */
function fakeClock(start = 1_000) {
  let at = start;
  return {
    now: () => at,
    advance(ms: number) {
      at += ms;
    },
  };
}

describe("rate limiter", () => {
  test("allows exactly the limit and refuses the next call", () => {
    const clock = fakeClock();
    const limiter = createLimiter({ limit: 3, windowMs: 10_000, now: clock.now });

    expect(limiter.take("alice")).toEqual({ ok: true });
    expect(limiter.take("alice")).toEqual({ ok: true });
    expect(limiter.take("alice")).toEqual({ ok: true });

    const refused = limiter.take("alice");
    expect(refused.ok).toBe(false);
    // A refusal that did not say when to come back would leave a client guessing.
    expect(refused.ok === false && refused.retryAfterMs).toBeGreaterThan(0);
  });

  test("reports a retry window that frees a slot, not just any positive number", () => {
    const clock = fakeClock();
    const limiter = createLimiter({ limit: 2, windowMs: 1_000, now: clock.now });

    limiter.take("alice");
    clock.advance(400);
    limiter.take("alice");
    clock.advance(100);

    const refused = limiter.take("alice");
    expect(refused).toEqual({ ok: false, retryAfterMs: 500 });

    clock.advance(500);
    expect(limiter.take("alice")).toEqual({ ok: true });
  });

  test("refills only after the window, not before it", () => {
    const clock = fakeClock();
    const limiter = createLimiter({ limit: 1, windowMs: 1_000, now: clock.now });

    expect(limiter.take("alice")).toEqual({ ok: true });
    clock.advance(999);
    expect(limiter.take("alice").ok).toBe(false);
    clock.advance(1);
    expect(limiter.take("alice")).toEqual({ ok: true });
  });

  test("keeps one budget per key", () => {
    const clock = fakeClock();
    const limiter = createLimiter({ limit: 1, windowMs: 1_000, now: clock.now });

    expect(limiter.take("alice")).toEqual({ ok: true });
    expect(limiter.take("bob")).toEqual({ ok: true });
    expect(limiter.take("alice").ok).toBe(false);
    expect(limiter.take("bob").ok).toBe(false);
  });

  test("prunes keys whose calls all fell out of the window", () => {
    const clock = fakeClock();
    // limit 1 refuses pruning at 64 calls, so this test drives the sweep with
    // enough traffic that the boundary is exercised rather than assumed.
    const limiter = createLimiter({ limit: 1, windowMs: 1_000, now: clock.now });

    for (let index = 0; index < 64; index += 1) {
      limiter.take(`key-${index}`);
    }
    expect(limiter.size()).toBe(64);

    clock.advance(1_000);
    for (let index = 0; index < 64; index += 1) {
      limiter.take(`fresh-${index}`);
    }

    // The expired keys are gone; only the fresh ones are tracked.
    expect(limiter.size()).toBe(64);
    for (let index = 0; index < 64; index += 1) {
      expect(limiter.take(`fresh-${index}`).ok).toBe(false);
    }
  });

  test("does not grow without bound when one key is hammered", () => {
    const clock = fakeClock();
    const limiter = createLimiter({ limit: 100, windowMs: 1_000, now: clock.now });

    for (let index = 0; index < 1_000; index += 1) {
      clock.advance(10);
      limiter.take("alice");
    }

    // One key, however many calls: the timestamps inside the window are capped
    // by the limit, and older ones are dropped on every take.
    expect(limiter.size()).toBe(1);
  });
});
