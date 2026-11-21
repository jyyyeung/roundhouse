import type { Logger } from "../log";
import { DeadlineExceededError, withDeadline } from "./deadline";

/**
 * Graceful shutdown, in the order that loses the least work:
 *
 * 1. stop accepting connections (the orchestrator stops routing here),
 * 2. close WebSocket sessions with a reason, so clients reconnect immediately
 *    instead of waiting out their backoff cap,
 * 3. let in-flight work finish under a bounded budget,
 * 4. close the database pool,
 * 5. exit.
 *
 * Every step is best-effort: a step that throws is logged and the next one runs.
 * The alternative — aborting the sequence on the first error — leaves the pool
 * open and the process waiting for a signal that will not come again.
 */
export type ShutdownStep = {
  name: string;
  close: () => Promise<void> | void;
};

export type GracefulShutdownOptions = {
  steps: readonly ShutdownStep[];
  /** Total budget for every step combined. */
  timeoutMs?: number;
  logger?: Logger;
  /** Injected by tests; production calls `process.exit`. */
  exit?: (code: number) => void;
};

export const SHUTDOWN_TIMEOUT_MS = 5000;

export type ShutdownResult = {
  signal: string;
  durationMs: number;
  forced: boolean;
  steps: Array<{ name: string; ok: boolean; durationMs: number; reason?: string }>;
};

export function createGracefulShutdown(options: GracefulShutdownOptions): {
  /** Idempotent: a second signal returns the shutdown already in progress. */
  shutdown: (signal: string) => Promise<ShutdownResult>;
} {
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  const log = options.logger;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let inFlight: Promise<ShutdownResult> | null = null;

  async function run(signal: string): Promise<ShutdownResult> {
    const startedAt = performance.now();
    const deadline = startedAt + timeoutMs;
    const results: ShutdownResult["steps"] = [];
    let forced = false;
    // Once one step eats the budget, starting the next one only delays the exit:
    // the remaining steps are reported as skipped instead.
    let budgetSpent = false;

    log?.info("shutdown.start", { signal, timeoutMs });

    for (const step of options.steps) {
      const remaining = deadline - performance.now();
      if (budgetSpent || remaining <= 0) {
        forced = true;
        log?.error("shutdown.deadline_exceeded", { skipped: step.name, signal });
        results.push({ durationMs: 0, name: step.name, ok: false, reason: "deadline_exceeded" });
        continue;
      }

      const stepStartedAt = performance.now();
      try {
        await withDeadline(Promise.resolve().then(step.close), remaining);
        const durationMs = Math.round(performance.now() - stepStartedAt);
        log?.debug("shutdown.step", { durationMs, signal, step: step.name });
        results.push({ durationMs, name: step.name, ok: true });
      } catch (error) {
        const durationMs = Math.round(performance.now() - stepStartedAt);
        const reason = error instanceof Error ? error.message : String(error);
        if (error instanceof DeadlineExceededError) {
          forced = true;
          budgetSpent = true;
        }
        log?.error("shutdown.step_failed", { durationMs, reason, signal, step: step.name });
        results.push({ durationMs, name: step.name, ok: false, reason });
      }
    }

    const result: ShutdownResult = {
      durationMs: Math.round(performance.now() - startedAt),
      forced,
      signal,
      steps: results,
    };
    log?.info("shutdown.done", { ...result });
    exit(0);
    return result;
  }

  return {
    shutdown(signal) {
      inFlight ??= run(signal);
      return inFlight;
    },
  };
}
