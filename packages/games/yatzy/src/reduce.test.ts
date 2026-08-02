import { describe, expect, it, vi } from "vitest";
import { yatzyCategories } from "./categories";
import { yatzyModule } from "./module";
import { reduce, type YatzyState } from "./reduce";

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    ruleset: "yatzy" as const,
    playerIds: ["p1", "p2"],
    currentPlayerIndex: 0,
    rollsLeft: 3,
    dice: [0, 0, 0, 0, 0],
    holds: [false, false, false, false, false],
    sheets: {
      p1: Object.fromEntries(yatzyCategories.map((category) => [category, null])),
      p2: Object.fromEntries(yatzyCategories.map((category) => [category, null])),
    },
    phase: "playing" as const,
    winnerIds: [] as string[],
    ...overrides,
  };
}

describe("reduce", () => {
  it("rejects roll when it is not the active player's turn", () => {
    const result = reduce(
      baseState(),
      { type: "roll", payload: {} },
      {
        actorId: "p2",
        now: () => new Date("2026-08-02T00:00:00.000Z"),
        playerIds: ["p1", "p2"],
        randomInt: vi.fn(),
      }
    );

    expect(result).toEqual({ ok: false, error: "not_your_turn" });
  });

  it("rolls dice with randomInt and decrements rollsLeft", () => {
    const randomInt = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(3)
      .mockReturnValueOnce(4);

    const result = reduce(
      baseState(),
      { type: "roll", payload: {} },
      {
        actorId: "p1",
        now: () => new Date("2026-08-02T00:00:00.000Z"),
        playerIds: ["p1", "p2"],
        randomInt,
      }
    );

    expect(result).toEqual({
      ok: true,
      events: [
        {
          actorId: "p1",
          gameId: "yatzy",
          payload: {},
          tableId: "yatzy",
          type: "dice_rolled",
        },
      ],
      state: expect.objectContaining({
        dice: [1, 2, 3, 4, 5],
        rollsLeft: 2,
      }),
    });
  });

  it("keeps held dice on reroll", () => {
    const state = baseState({
      dice: [1, 2, 3, 4, 5],
      rollsLeft: 2,
      holds: [true, false, true, false, false],
    });
    const randomInt = vi.fn().mockReturnValueOnce(5).mockReturnValueOnce(4).mockReturnValueOnce(3);

    const result = reduce(
      state,
      { type: "roll", payload: {} },
      {
        actorId: "p1",
        now: () => new Date("2026-08-02T00:00:00.000Z"),
        playerIds: ["p1", "p2"],
        randomInt,
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toMatchObject({
      dice: [1, 6, 3, 5, 4],
      rollsLeft: 1,
    });
  });

  it("updates holds for the active player", () => {
    const result = reduce(
      baseState({ rollsLeft: 2 }),
      { type: "set_holds", payload: { holds: [true, false, true, false, true] } },
      {
        actorId: "p1",
        now: () => new Date("2026-08-02T00:00:00.000Z"),
        playerIds: ["p1", "p2"],
        randomInt: vi.fn(),
      }
    );

    expect(result).toEqual({
      ok: true,
      events: [
        {
          actorId: "p1",
          gameId: "yatzy",
          payload: { holds: [true, false, true, false, true] },
          tableId: "yatzy",
          type: "dice_held",
        },
      ],
      state: expect.objectContaining({
        holds: [true, false, true, false, true],
      }),
    });
  });

  it("rejects score before any roll", () => {
    const result = reduce(
      baseState(),
      { type: "score", payload: { category: "ones" } },
      {
        actorId: "p1",
        now: () => new Date("2026-08-02T00:00:00.000Z"),
        playerIds: ["p1", "p2"],
        randomInt: vi.fn(),
      }
    );

    expect(result).toEqual({ ok: false, error: "must_roll_first" });
  });

  it("scores a category, advances turn, and stores the score", () => {
    const state = baseState({
      dice: [1, 1, 3, 4, 6],
      rollsLeft: 2,
    });

    const result = reduce(
      state,
      { type: "score", payload: { category: "ones" } },
      {
        actorId: "p1",
        now: () => new Date("2026-08-02T00:00:00.000Z"),
        playerIds: ["p1", "p2"],
        randomInt: vi.fn(),
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toMatchObject({
      currentPlayerIndex: 1,
      rollsLeft: 3,
      dice: [0, 0, 0, 0, 0],
      holds: [false, false, false, false, false],
      sheets: {
        p1: expect.objectContaining({ ones: 2 }),
      },
    });
    expect(result.events).toEqual([
      {
        actorId: "p1",
        gameId: "yatzy",
        payload: { category: "ones", score: 2 },
        tableId: "yatzy",
        type: "category_scored",
      },
      {
        actorId: "p1",
        gameId: "yatzy",
        payload: { currentPlayerId: "p2" },
        tableId: "yatzy",
        type: "turn_advanced",
      },
    ]);
  });

  it("applies the Yahtzee upper bonus at 63 or more", () => {
    const state = baseState({
      ruleset: "yahtzee" as const,
      sheets: {
        p1: {
          ones: 3,
          twos: 6,
          threes: 9,
          fours: 12,
          fives: 15,
          sixes: null,
          three_kind: null,
          four_kind: null,
          full_house: null,
          small_straight: null,
          large_straight: null,
          yahtzee: null,
          chance: null,
        },
        p2: Object.fromEntries(yatzyCategories.map((category) => [category, null])),
      },
      dice: [6, 6, 6, 6, 6],
      rollsLeft: 2,
    });

    const result = reduce(
      state,
      { type: "score", payload: { category: "sixes" } },
      {
        actorId: "p1",
        now: () => new Date("2026-08-02T00:00:00.000Z"),
        playerIds: ["p1", "p2"],
        randomInt: vi.fn(),
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.state as YatzyState).sheets.p1.bonus).toBe(35);
  });

  it("finishes the game when all categories are filled", () => {
    const filled = Object.fromEntries(
      yatzyCategories.map((category, index) => [
        category,
        category === "chance" ? null : index + 1,
      ])
    );
    const state = baseState({
      sheets: {
        p1: filled,
        p2: Object.fromEntries(yatzyCategories.map((category) => [category, 1])),
      },
      dice: [1, 2, 3, 4, 5],
      rollsLeft: 2,
    });

    const result = reduce(
      state,
      { type: "score", payload: { category: "chance" } },
      {
        actorId: "p1",
        now: () => new Date("2026-08-02T00:00:00.000Z"),
        playerIds: ["p1", "p2"],
        randomInt: vi.fn(),
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finishedState = result.state as YatzyState;
    expect(finishedState.phase).toBe("finished");
    expect(finishedState.winnerIds).toEqual(["p1"]);
    expect(result.events.at(-1)).toEqual({
      actorId: "p1",
      gameId: "yatzy",
      payload: { winnerIds: ["p1"] },
      tableId: "yatzy",
      type: "game_finished",
    });
  });
});

describe("yatzyModule", () => {
  it("creates initial state and public snapshot", () => {
    const state = yatzyModule.createInitialState({ ruleset: "yahtzee" }, ["p1", "p2"]);
    const snapshot = yatzyModule.getPublicSnapshot(state);

    expect(state).toMatchObject({
      ruleset: "yahtzee",
      currentPlayerIndex: 0,
      rollsLeft: 3,
      dice: [0, 0, 0, 0, 0],
      holds: [false, false, false, false, false],
      phase: "playing",
      winnerIds: [],
    });
    expect(snapshot).toMatchObject({
      gameId: "yatzy",
      ruleset: "yahtzee",
      currentPlayerId: "p1",
      rollsLeft: 3,
      dice: [0, 0, 0, 0, 0],
      holds: [false, false, false, false, false],
      phase: "playing",
      winnerIds: [],
    });
    expect(yatzyModule.isFinished(state)).toBe(false);
  });
});
