import { describe, expect, it } from "vitest";

import { buildShareUrl, normalizeJoinCode } from "./tables";

describe("table helpers", () => {
  it("normalizes join codes to compact uppercase text", () => {
    expect(normalizeJoinCode(" ab c123 ")).toBe("ABC123");
  });

  it("builds share links for table invites", () => {
    expect(
      buildShareUrl({
        webBaseUrl: "https://play.yatzy.test",
        tableId: "table-123",
        code: "ABCD23",
      }),
    ).toBe("https://play.yatzy.test/t/table-123?code=ABCD23");
  });
});
