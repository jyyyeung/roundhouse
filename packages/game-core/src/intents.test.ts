import { describe, expect, it } from "vitest";
import { intentFromClientMessage } from "./intents";

describe("intentFromClientMessage", () => {
  it("maps intentType to type", () => {
    expect(
      intentFromClientMessage({
        v: 1,
        type: "intent",
        tableId: "t1",
        actionId: "a1",
        intentType: "roll",
        payload: { dice: [1, 2, 3] },
      }),
    ).toEqual({ type: "roll", payload: { dice: [1, 2, 3] } });
  });
});
