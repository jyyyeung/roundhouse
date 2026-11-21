import { describe, expect, it } from "vitest";

import { createLogger } from "./log";

function capture(options?: Parameters<typeof createLogger>[0]) {
  const lines: string[] = [];
  const logger = createLogger({
    level: "debug",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    sink: (line) => lines.push(line),
    ...options,
  });
  return { logger, lines, parsed: () => lines.map((line) => JSON.parse(line)) };
}

describe("structured logger", () => {
  it("writes one JSON object per line with level, time, msg and fields", () => {
    const { logger, parsed } = capture();

    logger.info("server.listening", { port: 3001 });

    expect(parsed()).toEqual([
      { level: "info", msg: "server.listening", port: 3001, time: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("drops fields below the configured level", () => {
    const { logger, parsed } = capture({ level: "warn" });

    logger.debug("noise");
    logger.info("also noise");
    logger.warn("worth keeping");

    expect(parsed().map((line) => line.msg)).toEqual(["worth keeping"]);
  });

  it("falls back to info for an unparseable LOG_LEVEL instead of throwing", () => {
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "verbose";
    try {
      expect(createLogger({ sink: () => {} }).level).toBe("info");
    } finally {
      process.env.LOG_LEVEL = previous;
    }
  });

  it("merges child fields into every line without changing the parent", () => {
    const { logger, parsed } = capture();
    const connection = logger.child({ component: "ws.hub", connectionId: "c1" });

    connection.warn("ws.bad_message", { code: "bad_message" });
    logger.info("server.listening");

    const [child, parent] = parsed();
    expect(child).toMatchObject({ component: "ws.hub", connectionId: "c1", code: "bad_message" });
    expect(parent).not.toHaveProperty("component");
    expect(parent).not.toHaveProperty("connectionId");
  });

  it("renders an Error as name, message and stack rather than an empty object", () => {
    const { logger, parsed } = capture();

    logger.error("chat.persist_failed", { error: new Error("insert failed") });

    expect(parsed()[0].error).toMatchObject({ name: "Error", message: "insert failed" });
    expect(parsed()[0].error.stack).toContain("insert failed");
  });

  it("omits undefined fields and keeps null, so a missing value is visible as absent", () => {
    const { logger, parsed } = capture();

    logger.info("probe", { actionId: undefined, tableId: null });

    expect(parsed()[0]).not.toHaveProperty("actionId");
    expect(parsed()[0].tableId).toBeNull();
  });

  it("never lets a failing sink take the caller down", () => {
    const logger = createLogger({
      level: "info",
      sink: () => {
        throw new Error("stdout is gone");
      },
    });

    expect(() => logger.error("still alive")).not.toThrow();
  });
});
