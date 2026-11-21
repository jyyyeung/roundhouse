import type { Context } from "hono";

import type { Logger } from "../log";
import { withDeadline } from "./deadline";

/**
 * Liveness and readiness, deliberately separate.
 *
 * `/health` answers "is this process alive?" and must never touch the network:
 * an orchestrator that restarts on a failed liveness probe would otherwise
 * restart-loop the server every time Postgres blipped. `/ready` answers "should
 * this process receive traffic?" and is allowed to be slow enough to be useful —
 * but not slow enough to hold a load balancer open, so every check runs under a
 * deadline and a missed deadline is a failure.
 */
export const READY_TIMEOUT_MS = 1000;

export type ProbeCheck = {
  /** Stable name in the response body, e.g. `database` or `migrations`. */
  name: string;
  /** Resolves when healthy; throws (or rejects) with the reason when not. */
  run: () => Promise<void>;
};

export type CheckResult =
  | { name: string; ok: true; durationMs: number }
  | { name: string; ok: false; durationMs: number; reason: string };

export type ReadyResponse = {
  ok: boolean;
  checks: CheckResult[];
};

/**
 * A readiness answer must arrive faster than a load balancer's patience, so each
 * check runs under `timeoutMs`; a missed deadline is a failed check.
 */
function runCheck(check: ProbeCheck, timeoutMs: number): Promise<void> {
  return withDeadline(Promise.resolve().then(check.run), timeoutMs);
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function createReadinessHandler(input: {
  checks: readonly ProbeCheck[];
  timeoutMs?: number;
  logger?: Logger;
}): (c: Context) => Promise<Response> {
  const timeoutMs = input.timeoutMs ?? READY_TIMEOUT_MS;
  const log = input.logger;

  return async (c) => {
    const results = await Promise.all(
      input.checks.map(async (check): Promise<CheckResult> => {
        const startedAt = performance.now();
        try {
          await runCheck(check, timeoutMs);
          return { durationMs: round(performance.now() - startedAt), name: check.name, ok: true };
        } catch (error) {
          const durationMs = round(performance.now() - startedAt);
          const reason = describe(error);
          log?.warn("ready.check_failed", { check: check.name, durationMs, reason });
          return { durationMs, ok: false, name: check.name, reason };
        }
      }),
    );

    const ok = results.every((result) => result.ok);
    const body: ReadyResponse = { checks: results, ok };
    return c.json(body, ok ? 200 : 503);
  };
}

/** Liveness: no I/O, no dependencies, cannot fail while the process can answer. */
export function createLivenessHandler(): (c: Context) => Response {
  return (c) => c.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
