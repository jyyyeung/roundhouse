import { describe, expect, it } from "vitest";
import { z } from "zod";

import { intentFromClientMessage, parseIntent } from "./intents";

const schemas = {
  roll: z.object({}).strict(),
  score: z.object({ category: z.string().min(1) }),
};

describe("parseIntent", () => {
  it("rejects an intent the module never declared", () => {
    expect(parseIntent(schemas, { payload: {}, type: "dance" })).toEqual({
      code: "unknown_intent",
      detail: "dance",
      ok: false,
    });
  });

  it("rejects a declared intent with the wrong payload shape", () => {
    const result = parseIntent(schemas, { payload: {}, type: "score" });

    expect(result).toMatchObject({ code: "invalid_payload", ok: false });
    expect(result.ok === false && result.detail).toContain("category");
  });

  it("returns the parsed payload, not the raw one", () => {
    const result = parseIntent(schemas, { payload: { category: "ones", extra: true }, type: "score" });

    expect(result).toEqual({ intent: { payload: { category: "ones" }, type: "score" }, ok: true });
  });

  it("passes an empty payload to an intent that takes none", () => {
    expect(parseIntent(schemas, { payload: {}, type: "roll" })).toEqual({
      intent: { payload: {}, type: "roll" },
      ok: true,
    });
  });
});

describe("intentFromClientMessage", () => {
  it("lifts the wire frame into the shape modules consume", () => {
    expect(
      intentFromClientMessage({
        actionId: "action-1",
        intentType: "roll",
        payload: {},
        tableId: "table-1",
        type: "intent",
        v: 1,
      }),
    ).toEqual({ payload: {}, type: "roll" });
  });
});
