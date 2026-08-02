import { describe, expect, it } from "vitest";
import { SAFE_ALPHABET, generateInviteCode } from "./codes";

describe("generateInviteCode", () => {
  it("returns length 6 by default using safe alphabet", () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(6);
    for (const ch of code) expect(SAFE_ALPHABET.includes(ch)).toBe(true);
  });

  it("never includes ambiguous characters", () => {
    const code = generateInviteCode(8);
    expect(code).not.toMatch(/[0O1I]/i);
  });
});

