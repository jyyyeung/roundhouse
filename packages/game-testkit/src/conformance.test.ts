import type { Json } from "@roundhouse/game-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  assertProjectionHidesSecret,
  type ConformanceFixtures,
  describeModuleConformance,
  REPLAY_GAMES,
} from "./conformance";
import { makeTallyModule, type TallyState } from "./test-support/tally";

/**
 * The testkit's own tests, and the answer to the objection "how do you know the
 * conformance suite can fail?":
 *
 * - the whole suite runs against a second, deliberately different game, so it is
 *   not shaped around yatzy;
 * - the leak check is pointed at a module that publishes the secret, and the
 *   failure is asserted, so a refactor that makes the check vacuous breaks here.
 */

function tallyFixtures(overrides: Partial<ConformanceFixtures> = {}): ConformanceFixtures {
  return {
    config: null,
    playerIds: ["alice", "bob", "carol"],
    now: "2026-01-01T00:00:00.000Z",
    script: [
      { actorId: "alice", type: "tap", payload: {} },
      { actorId: "bob", type: "tap", payload: {} },
      { actorId: "carol", type: "tap", payload: {} },
    ],
    nextIntent: (state, _rng) => {
      const current = state as TallyState;
      if (current.phase === "finished") return null;
      return {
        actorId: current.playerIds[current.currentPlayerIndex] as string,
        type: "tap",
        payload: {},
      };
    },
    plantSecret: (state, marker) => ({ ...(state as Record<string, Json>), secret: marker }),
    secretMarker: "conformance-secret",
    secretVisibility: "hidden-from-all",
    playerCounts: { min: 2, max: 3 },
    maxIntentsToFinish: 20,
    ...overrides,
  };
}

// The suite must pass for a game that is not yatzy, with no testkit changes.
describeModuleConformance(makeTallyModule(), tallyFixtures());

describe("conformance suite self-check", () => {
  it(`plays ${REPLAY_GAMES} games without inventing states replay cannot reach`, () => {
    // Guards the constant itself: lowering the replay count is a change to the
    // suite's strength, and it should be a deliberate one.
    expect(REPLAY_GAMES).toBeGreaterThanOrEqual(200);
  });

  it("fails the leak check when a projection publishes the secret", () => {
    expect(() => assertProjectionHidesSecret(makeTallyModule("everyone"), tallyFixtures())).toThrow(
      /leaks "conformance-secret" to player alice \(seat 0\), player bob \(seat 1\)/,
    );
  });

  it("names every viewer that saw the secret, and no viewer that did not", () => {
    expect(() => assertProjectionHidesSecret(makeTallyModule("everyone"), tallyFixtures())).toThrow(
      /spectator anonymous/,
    );
    expect(() =>
      assertProjectionHidesSecret(makeTallyModule("none"), tallyFixtures()),
    ).not.toThrow();
  });

  it("honours owner-only secrets", () => {
    const ownerOnly = makeTallyModule("owner-only");

    // The owner is allowed to see their own hand ...
    expect(() =>
      assertProjectionHidesSecret(ownerOnly, tallyFixtures({ secretVisibility: "owner-only" })),
    ).not.toThrow();

    // ... but a deck is not a hand: with hidden-from-all the owner may not either.
    expect(() => assertProjectionHidesSecret(ownerOnly, tallyFixtures())).toThrow(
      /player alice \(seat 0\)/,
    );
  });

  it("refuses to pass when plantSecret planted nothing", () => {
    // A check that inspects an empty string always succeeds; this is the guard
    // against that failure mode.
    expect(() =>
      assertProjectionHidesSecret(
        makeTallyModule("none"),
        tallyFixtures({ plantSecret: (state) => state }),
      ),
    ).toThrow(/plantSecret did not put "conformance-secret" into the state/);
  });
});

describe("module seat and config declarations", () => {
  const withPlayerCount = (playerCount: { min: number; max: number }) => ({
    ...makeTallyModule(),
    playerCount,
  });
  const withDefaultConfig = (defaultConfig: Json) => ({
    ...makeTallyModule(),
    defaultConfig,
  });

  it("rejects a module whose seat range is inverted", () => {
    expect(() =>
      assertProjectionHidesSecret(withPlayerCount({ min: 3, max: 2 }), tallyFixtures()),
    ).toThrow(/module.playerCount must satisfy 1 <= min <= max/);
  });

  it("rejects fixtures that disagree with the module's seat range", () => {
    // Otherwise a module could claim 2-6 players while every conformance game was
    // played at 3, and the seat limit would never be exercised.
    expect(() =>
      assertProjectionHidesSecret(withPlayerCount({ min: 2, max: 5 }), tallyFixtures()),
    ).toThrow(/fixtures.playerCounts \(2-3\) must equal module.playerCount \(2-5\)/);
  });

  it("rejects a default config the module's own schema would not accept", () => {
    const picky = {
      ...makeTallyModule(),
      configSchema: z.object({ rounds: z.number() }),
    };

    expect(() =>
      assertProjectionHidesSecret({ ...picky, defaultConfig: { rounds: "many" } }, tallyFixtures()),
    ).toThrow(/module.defaultConfig must satisfy module.configSchema/);
    expect(() =>
      assertProjectionHidesSecret({ ...picky, defaultConfig: { rounds: 3 } }, tallyFixtures()),
    ).not.toThrow();
  });

  it("accepts a module whose default config passes its own schema", () => {
    expect(() =>
      assertProjectionHidesSecret(withDefaultConfig({ anything: true }), tallyFixtures()),
    ).not.toThrow();
  });
});
