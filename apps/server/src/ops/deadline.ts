/**
 * Small deadline helper shared by the readiness probe and graceful shutdown.
 *
 * The wrapped promise keeps running past the deadline — cancelling an arbitrary
 * promise is not something JavaScript offers, and a `SELECT 1` that outlives its
 * probe should be allowed to fail on its own. What the deadline guarantees is
 * that *the caller* stops waiting.
 */
export class DeadlineExceededError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`did not finish within ${timeoutMs}ms`);
    this.name = "DeadlineExceededError";
    this.timeoutMs = timeoutMs;
  }
}

export function withDeadline<T>(run: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError(timeoutMs)), timeoutMs);
    // A pending deadline must never be the reason the process stays alive.
    timer.unref?.();
  });

  return Promise.race([run, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
