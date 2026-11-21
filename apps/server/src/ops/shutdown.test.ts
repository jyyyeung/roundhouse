import { describe, expect, it } from "vitest";

import { createLogger } from "../log";
import { createGracefulShutdown, type ShutdownStep } from "./shutdown";

function harness(steps: ShutdownStep[], timeoutMs?: number) {
  const order: string[] = [];
  const exits: number[] = [];
  const lines: string[] = [];
  const shutdown = createGracefulShutdown({
    steps,
    exit: (code) => exits.push(code),
    logger: createLogger({ level: "debug", sink: (line) => lines.push(line) }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return {
    exits,
    lines: () => lines.map((line) => JSON.parse(line)),
    order,
    run: (signal = "SIGTERM") => shutdown.shutdown(signal),
  };
}

describe("graceful shutdown", () => {
  it("runs every step in order and exits 0", async () => {
    const { order, run, exits } = harness([
      {
        name: "http",
        close: () => {
          order.push("http");
        },
      },
      {
        name: "ws",
        close: () => {
          order.push("ws");
        },
      },
      {
        name: "db",
        close: async () => {
          order.push("db");
        },
      },
    ]);

    const result = await run();

    expect(order).toEqual(["http", "ws", "db"]);
    expect(result.forced).toBe(false);
    expect(result.steps.every((step) => step.ok)).toBe(true);
    expect(exits).toEqual([0]);
  });

  it("keeps going when a step throws, and still exits 0", async () => {
    const { order, run, exits, lines } = harness([
      {
        name: "ws",
        close: () => {
          throw new Error("socket already gone");
        },
      },
      {
        name: "db",
        close: () => {
          order.push("db");
        },
      },
    ]);

    const result = await run();

    expect(order).toEqual(["db"]);
    expect(result.steps[0]).toMatchObject({ name: "ws", ok: false, reason: "socket already gone" });
    expect(result.forced).toBe(false);
    expect(exits).toEqual([0]);
    expect(lines()).toContainEqual(
      expect.objectContaining({ level: "error", msg: "shutdown.step_failed", step: "ws" }),
    );
  });

  it("is idempotent: a second signal does not re-run the steps", async () => {
    let closes = 0;
    const { run, exits } = harness([
      {
        name: "only",
        close: () => {
          closes += 1;
        },
      },
    ]);

    const [first, second] = await Promise.all([run("SIGTERM"), run("SIGINT")]);

    expect(closes).toBe(1);
    expect(first).toBe(second);
    expect(exits).toEqual([0]);
  });

  it("gives up at the deadline and marks the shutdown forced", async () => {
    const { run, exits, lines } = harness(
      [
        { name: "hung", close: () => new Promise<void>(() => {}) },
        { name: "db", close: async () => {} },
      ],
      30,
    );

    const result = await run();

    expect(result.forced).toBe(true);
    expect(result.steps[0]).toMatchObject({ name: "hung", ok: false });
    expect(result.steps[1]).toMatchObject({ name: "db", ok: false, reason: "deadline_exceeded" });
    expect(exits).toEqual([0]);
    expect(lines()).toContainEqual(
      expect.objectContaining({ level: "error", msg: "shutdown.deadline_exceeded", skipped: "db" }),
    );
  });

  it("logs the signal it received and the outcome", async () => {
    const { run, lines } = harness([{ name: "db", close: async () => {} }]);

    await run("SIGINT");

    const messages = lines().map((line) => line.msg);
    expect(messages).toContain("shutdown.start");
    expect(messages).toContain("shutdown.done");
    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: "shutdown.start", signal: "SIGINT" }),
    );
  });
});
