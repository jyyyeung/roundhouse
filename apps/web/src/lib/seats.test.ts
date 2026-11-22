import { describe, expect, it } from "vitest";

import { avatarFor, avatarStyle, seatLabels } from "./seats";

describe("seatLabels", () => {
  it("names the viewer You and everyone else by seat number", () => {
    expect(seatLabels(["user-a", "user-b", "user-c"], "user-b")).toEqual({
      "user-a": "Player 1",
      "user-b": "You",
      "user-c": "Player 3",
    });
  });

  it("names every seat by number when nobody is signed in", () => {
    expect(seatLabels(["user-a", "user-b"], null)).toEqual({
      "user-a": "Player 1",
      "user-b": "Player 2",
    });
  });

  it("is empty for an empty lobby", () => {
    expect(seatLabels([], "user-a")).toEqual({});
  });
});

describe("avatarFor", () => {
  it("gives the same player the same colour on every call", () => {
    const first = avatarFor("user-a");
    const second = avatarFor("user-a");
    expect(first).toEqual(second);
    expect(first.hue).toBeGreaterThanOrEqual(0);
    expect(first.hue).toBeLessThan(360);
  });

  it("separates two players by initials or hue", () => {
    const a = avatarFor("user-a");
    const b = avatarFor("user-b");
    expect(a.initials + a.hue).not.toBe(b.initials + b.hue);
  });

  it("turns an id into uppercase initials and copes with a junk id", () => {
    expect(avatarFor("user-a").initials).toBe("US");
    expect(avatarFor("9f8e7d").initials).toBe("9F");
    expect(avatarFor("---").initials).toBe("?");
  });

  it("styles a chip with the player's hue", () => {
    expect(avatarStyle("user-a").backgroundColor).toBe(`hsl(${avatarFor("user-a").hue} 70% 45%)`);
  });
});
