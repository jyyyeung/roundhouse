import { parseIntent } from "@roundhouse/game-core";
import { describe, expect, it } from "vitest";

import { yatzyIntents } from "./intents";

describe("yatzy intent contract", () => {
  it("declares exactly the intents reduce handles", () => {
    // If reduce grows a branch, this list has to grow with it, or the new intent is
    // unreachable: the server rejects anything missing here before reduce runs.
    expect(Object.keys(yatzyIntents).sort()).toEqual(["roll", "score", "set_holds"]);
  });

  it("accepts the payloads the UI sends", () => {
    expect(parseIntent(yatzyIntents, { payload: {}, type: "roll" }).ok).toBe(true);
    expect(
      parseIntent(yatzyIntents, { payload: { holds: [true, false, false, true, false] }, type: "set_holds" })
        .ok,
    ).toBe(true);
    expect(parseIntent(yatzyIntents, { payload: { category: "ones" }, type: "score" }).ok).toBe(true);
  });

  it("rejects payloads reduce would have to defend against", () => {
    expect(parseIntent(yatzyIntents, { payload: {}, type: "score" })).toMatchObject({
      code: "invalid_payload",
      ok: false,
    });
    expect(parseIntent(yatzyIntents, { payload: { holds: [true] }, type: "set_holds" })).toMatchObject({
      code: "invalid_payload",
      ok: false,
    });
    expect(parseIntent(yatzyIntents, { payload: {}, type: "dance" })).toMatchObject({
      code: "unknown_intent",
      ok: false,
    });
  });
});
