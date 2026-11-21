import type { EventEnvelope, Json, ReduceContext } from "@roundhouse/game-core";
import { describe, expect, it } from "vitest";

import { applyYatzyEvent } from "./apply-event";
import { yatzyModule } from "./module";
import type { YatzyState } from "./reduce";

/** The module boundary is JSON-typed; the tests work in `YatzyState`. */
const json = (value: unknown) => value as Json;
const rollIntent = { payload: {}, type: "roll" };
/** Deterministic PRNG so a failing sequence is reproducible from its seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function envelope(
  event: Omit<EventEnvelope, "id" | "seq" | "createdAt">,
  seq: number,
): EventEnvelope {
  return { ...event, createdAt: new Date(0).toISOString(), id: `ev-${seq}`, seq };
}

function openCategories(state: YatzyState, playerId: string) {
  const sheet = state.sheets[playerId] ?? {};

  return Object.keys(sheet).filter((category) => category !== "bonus" && sheet[category] === null);
}

type Intent = { type: string; payload: Json };

function nextIntent(state: YatzyState, random: () => number): Intent {
  const actorId = state.playerIds[state.currentPlayerIndex];
  const open = openCategories(state, actorId);
  const roll = random();

  if (state.rollsLeft === 0 && open.length > 0) {
    return { payload: { category: open[Math.floor(random() * open.length)] }, type: "score" } as Intent;
  }

  if (state.rollsLeft === 3 || roll < 0.45) return rollIntent;

  if (roll < 0.7) {
    return {
      payload: { holds: state.dice.map(() => random() < 0.4) },
      type: "set_holds",
    };
  }

  if (open.length === 0) return rollIntent;

  return { payload: { category: open[Math.floor(random() * open.length)] }, type: "score" } as Intent;
}

/**
 * Invariant I3 (ADR 0002): the event log is a replay source. For any intent
 * sequence, folding the emitted events back into the pre-intent state has to
 * reproduce the post-intent state exactly — same dice, same sheets, same turn,
 * same winner.
 */
describe("event log replay", () => {
  const seenTypes = new Set<string>();

  it("reproduces state from events alone across randomised games", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = mulberry32(seed);
      const playerIds = ["user-a", "user-b", "user-c"].slice(0, 2 + (seed % 2));
      const config = { ruleset: seed % 3 === 0 ? "yahtzee" : "yatzy" };
      let state = yatzyModule.createInitialState(config, playerIds) as unknown as YatzyState;
      let applied = 0;
      let seq = 0;

      for (let step = 0; step < 400 && state.phase === "playing"; step++) {
        const actorId = state.playerIds[state.currentPlayerIndex];
        const ctx: ReduceContext = {
          actorId,
          now: () => new Date(0),
          playerIds: state.playerIds,
          randomInt: (maxExclusive) => Math.floor(random() * maxExclusive),
        };
        const intent = nextIntent(state, random);
        const before = state;
        const result = yatzyModule.reduce(json(before), intent, ctx);

        if (!result.ok) continue;

        const replayed = result.events.reduce<unknown>((acc, event) => {
          seq += 1;
          seenTypes.add(event.type);
          return applyYatzyEvent(acc, envelope(event, seq));
        }, before);

        expect(replayed, `seed ${seed} step ${step} (${intent.type})`).toEqual(result.state);
        state = result.state as unknown as YatzyState;
        applied += 1;
      }

      // Guard the guard: a sequence that never applied anything would pass silently.
      expect(applied, `seed ${seed}`).toBeGreaterThan(3);
    }
  });

  it("covers every event type the module emits", () => {
    expect([...seenTypes].sort()).toEqual([
      "category_scored",
      "dice_held",
      "dice_rolled",
      "game_finished",
      "turn_advanced",
    ]);
  });
});

describe("applyYatzyEvent", () => {
  const playerIds = ["user-a", "user-b"];
  const initial = yatzyModule.createInitialState({ ruleset: "yatzy" }, playerIds) as unknown as YatzyState;

  it("records the resolved dice, so a replay never re-rolls", () => {
    const rolled = yatzyModule.reduce(json(initial), rollIntent, {
      actorId: "user-a",
      now: () => new Date(0),
      playerIds,
      randomInt: () => 3,
    });

    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;

    const [event] = rolled.events;
    expect(event.type).toBe("dice_rolled");
    expect(event.payload).toEqual({ dice: [4, 4, 4, 4, 4], rollsLeft: 2 });
    expect(applyYatzyEvent(initial, envelope(event, 1))).toEqual(rolled.state);
  });

  it("applies the upper-section bonus exactly as the reducer does", () => {
    const sheet = {
      bonus: null,
      fives: 25,
      fours: 20,
      ones: 3,
      sixes: 18,
      threes: 9,
      twos: 4,
    };
    const state: YatzyState = { ...initial, sheets: { "user-a": sheet, "user-b": {} } };
    const replayed = applyYatzyEvent(state, {
      actorId: "user-a",
      payload: { category: "fives", nextPlayerId: "user-b", score: 20 },
      type: "category_scored",
    });

    expect(replayed.sheets["user-a"].fives).toBe(20);
    expect(replayed.sheets["user-a"].bonus).toBe(35);
  });

  it("ignores an event type it does not know, so a legacy log still replays", () => {
    const legacy = { actorId: "user-a", payload: { text: "hi" }, type: "chat_sent" };

    expect(applyYatzyEvent(initial, legacy)).toEqual(initial);
  });

  it("ignores a malformed payload instead of throwing", () => {
    const malformed = { actorId: "user-a", payload: { dice: "nope" }, type: "dice_rolled" };

    expect(applyYatzyEvent(initial, malformed)).toEqual(initial);
  });
});
