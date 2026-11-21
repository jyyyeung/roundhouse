import type { Json, ReduceContext } from "@roundhouse/game-core";
import { describe, expect, it } from "vitest";

import { applyDuelEvent } from "./apply-event";
import { createDuelState, DUEL_CARDS, type DuelState, reduce, roundWinner } from "./reduce";

const PLAYERS = ["alice", "bob"];
const NOW = new Date("2026-01-01T00:00:00.000Z");

function contextFor(actorId: string, randomInt: (maxExclusive: number) => number = () => 0) {
  return { actorId, now: () => NOW, playerIds: PLAYERS, randomInt } satisfies ReduceContext;
}

function freshState(overrides: Partial<DuelState> = {}): DuelState {
  return { ...createDuelState({ rounds: 3 }, PLAYERS), ...overrides };
}

/** Applies an intent and throws on rejection, so a legal script stays readable. */
function play(state: DuelState, actorId: string, card: string, randomInt?: (n: number) => number) {
  return reduce(
    state as unknown as Json,
    { payload: { card }, type: "play" },
    contextFor(actorId, randomInt),
  );
}

function expectOk(result: ReturnType<typeof reduce>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result;
}

function expectFail(result: ReturnType<typeof reduce>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error;
}

describe("duel round rules", () => {
  it("decides every pair exactly once", () => {
    const table: Array<[string, string, number | null]> = [
      ["strike", "guard", 1],
      ["strike", "feint", 0],
      ["guard", "strike", 0],
      ["guard", "feint", 1],
      ["feint", "strike", 1],
      ["feint", "guard", 0],
    ];

    for (const [first, second, expected] of table) {
      expect(roundWinner(first as never, second as never)).toBe(expected);
    }
    for (const card of DUEL_CARDS) {
      expect(roundWinner(card, card)).toBeNull();
    }
  });

  it("starts on round one with no pick and no score", () => {
    const state = createDuelState({ rounds: 3 }, PLAYERS);

    expect(state.round).toBe(1);
    expect(state.totalRounds).toBe(3);
    expect(state.pending).toEqual({});
    expect(state.scores).toEqual({ alice: 0, bob: 0 });
    expect(state.phase).toBe("choosing");
    expect(state.winnerIds).toEqual([]);
    expect(state.decidedBy).toBeNull();
    expect(state.decisiveRoll).toBeNull();
  });

  it("falls back to three rounds for a config the schema rejects", () => {
    expect(createDuelState({ rounds: 0 }, PLAYERS).totalRounds).toBe(3);
    expect(createDuelState({ rounds: "many" }, PLAYERS).totalRounds).toBe(3);
    expect(createDuelState({}, PLAYERS).totalRounds).toBe(3);
    expect(createDuelState({ rounds: 5 }, PLAYERS).totalRounds).toBe(5);
  });
});

describe("duel picking", () => {
  it("keeps the first pick secret and logs only that the seat chose", () => {
    const result = expectOk(play(freshState(), "alice", "strike"));

    expect((result.state as unknown as DuelState).pending).toEqual({ alice: "strike" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe("duel_picked");
    // The card must not be in the log: events are broadcast unprojected.
    expect(JSON.stringify(result.events[0]?.payload)).not.toContain("strike");
    expect(result.events[0]?.payload).toEqual({ playerId: "alice" });
  });

  it("reveals both cards and scores the round when the second pick lands", () => {
    const first = expectOk(play(freshState(), "alice", "strike"));
    const second = expectOk(play(first.state as unknown as DuelState, "bob", "guard"));
    const state = second.state as unknown as DuelState;

    expect(state.pending).toEqual({});
    expect(state.round).toBe(2);
    expect(state.scores).toEqual({ alice: 0, bob: 1 });
    expect(state.rounds).toHaveLength(1);
    expect(state.rounds[0]).toEqual({
      plays: [
        { card: "strike", playerId: "alice" },
        { card: "guard", playerId: "bob" },
      ],
      round: 1,
      winnerId: "bob",
    });

    const reveal = second.events[0];
    expect(reveal?.type).toBe("duel_round");
    expect(reveal?.payload).toMatchObject({
      round: 1,
      scores: { alice: 0, bob: 1 },
      winnerId: "bob",
    });
  });

  it("scores nothing when both seats play the same card", () => {
    const first = expectOk(play(freshState(), "alice", "feint"));
    const second = expectOk(play(first.state as unknown as DuelState, "bob", "feint"));
    const state = second.state as unknown as DuelState;

    expect(state.scores).toEqual({ alice: 0, bob: 0 });
    expect(state.rounds[0]?.winnerId).toBeNull();
    expect(state.round).toBe(2);
  });

  it("orders the reveal by seat, not by who picked first", () => {
    const first = expectOk(play(freshState(), "bob", "feint"));
    const second = expectOk(play(first.state as unknown as DuelState, "alice", "strike"));
    const plays = (second.state as unknown as DuelState).rounds[0]?.plays ?? [];

    expect(plays.map((play) => play.playerId)).toEqual(["alice", "bob"]);
    expect((second.state as unknown as DuelState).scores).toEqual({ alice: 1, bob: 0 });
  });

  it("rejects a second pick in the same round", () => {
    const first = expectOk(play(freshState(), "alice", "strike"));
    expect(expectFail(play(first.state as unknown as DuelState, "alice", "guard"))).toBe(
      "already_played",
    );
  });

  it("rejects an unknown intent, an unknown card, and a stranger", () => {
    const state = freshState() as unknown as Json;

    expect(expectFail(reduce(state, { payload: {}, type: "roll" }, contextFor("alice")))).toBe(
      "unknown_intent",
    );
    expect(expectFail(play(freshState(), "alice", "lunge"))).toBe("invalid_card");
    expect(expectFail(play(freshState(), "mallory", "strike"))).toBe("not_a_player");
  });

  it("does not mutate the state it is handed", () => {
    const state = freshState();
    const before = JSON.stringify(state);

    play(state, "alice", "strike");

    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("duel finishing", () => {
  function playMatch(cards: Array<[string, string]>, randomInt?: (n: number) => number) {
    let state = freshState();
    const events = [];
    for (const [aliceCard, bobCard] of cards) {
      const first = expectOk(play(state, "alice", aliceCard));
      const second = expectOk(play(first.state as unknown as DuelState, "bob", bobCard, randomInt));
      events.push(...first.events, ...second.events);
      state = second.state as unknown as DuelState;
    }
    return { events, state };
  }

  it("gives the match to the higher score after the last round", () => {
    const { state, events } = playMatch([
      ["strike", "feint"],
      ["guard", "strike"],
      ["strike", "feint"],
    ]);

    expect(state.phase).toBe("finished");
    expect(state.scores).toEqual({ alice: 3, bob: 0 });
    expect(state.winnerIds).toEqual(["alice"]);
    expect(state.decidedBy).toBe("rounds");
    expect(state.decisiveRoll).toBeNull();
    expect(events.map((event) => event.type)).toEqual([
      "duel_picked",
      "duel_round",
      "duel_picked",
      "duel_round",
      "duel_picked",
      "duel_round",
      "game_finished",
    ]);
  });

  it("breaks a level match with one server roll and records the draw", () => {
    const { state, events } = playMatch(
      [
        ["strike", "guard"],
        ["guard", "strike"],
        ["feint", "feint"],
      ],
      () => 1,
    );

    expect(state.phase).toBe("finished");
    expect(state.scores).toEqual({ alice: 1, bob: 1 });
    expect(state.decidedBy).toBe("roll");
    expect(state.decisiveRoll).toEqual({ roll: 1, winnerId: "bob" });
    expect(state.winnerIds).toEqual(["bob"]);
    expect(events.at(-2)?.type).toBe("duel_decided");
    expect(events.at(-1)?.type).toBe("game_finished");
    expect(events.at(-1)?.payload).toEqual({ decidedBy: "roll", winnerIds: ["bob"] });
  });

  it("refuses a pick once the match is over", () => {
    const { state } = playMatch([
      ["strike", "guard"],
      ["strike", "guard"],
      ["strike", "guard"],
    ]);

    expect(expectFail(play(state, "alice", "strike"))).toBe("game_finished");
  });

  it("honours a one-round config", () => {
    const state = freshState({ totalRounds: 1 });

    const first = expectOk(play(state, "alice", "strike"));
    const round = expectOk(play(first.state as unknown as DuelState, "bob", "guard"));

    expect((round.state as unknown as DuelState).phase).toBe("finished");
  });
});

describe("duel replay", () => {
  it("rebuilds the final state by folding the recorded events", () => {
    const initial = createDuelState({ rounds: 3 }, PLAYERS);
    let state = initial;
    const events: Array<{ payload: Json; type: string }> = [];

    for (const [aliceCard, bobCard] of [
      ["strike", "guard"],
      ["guard", "strike"],
      ["feint", "feint"],
    ] as Array<[string, string]>) {
      const first = expectOk(play(state, "alice", aliceCard));
      const second = expectOk(play(first.state as unknown as DuelState, "bob", bobCard, () => 0));
      events.push(...first.events, ...second.events);
      state = second.state as unknown as DuelState;
    }

    let folded: unknown = initial;
    for (const event of events) {
      // Replay reads only what the log records; ids and clock are not game state.
      folded = applyDuelEvent(folded, {
        actorId: "alice",
        payload: event.payload,
        type: event.type,
      });
    }

    expect(JSON.parse(JSON.stringify(folded))).toEqual(JSON.parse(JSON.stringify(state)));
  });
});
