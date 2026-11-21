import type { Json } from "@roundhouse/game-core";
import {
  type ConformanceFixtures,
  describeModuleConformance,
  type FixtureIntent,
  pick,
} from "@roundhouse/game-testkit";

import { yahtzeeCategories, yatzyCategories } from "./categories";
import { yatzyModule } from "./module";
import type { YatzyState } from "./reduce";

/**
 * Yatzy's fixtures for the shared conformance suite (invariant I5). Yatzy has no
 * hidden information, so it exercises the projection side of the suite with a
 * marker planted in a field the view does not publish — the same shape a real
 * hidden-information module fails if it forgets to project.
 */

const PLAYERS = ["alice", "bob", "carol", "dave", "erin"];

function openCategories(state: YatzyState, playerId: string): string[] {
  const categories = state.ruleset === "yatzy" ? yatzyCategories : yahtzeeCategories;
  const sheet = state.sheets[playerId] ?? {};
  return categories.filter((category) => sheet[category] === null);
}

const fixtures: ConformanceFixtures = {
  config: { ruleset: "yatzy", tableId: "conformance-table" },
  playerIds: PLAYERS,
  now: "2026-01-01T00:00:00.000Z",
  script: [
    { actorId: "alice", type: "roll", payload: {} },
    { actorId: "alice", type: "set_holds", payload: { holds: [true, true, false, false, false] } },
    { actorId: "alice", type: "roll", payload: {} },
    { actorId: "alice", type: "score", payload: { category: "ones" } },
  ],
  nextIntent: (state, rng): FixtureIntent | null => {
    const current = state as YatzyState;
    if (current.phase === "finished") return null;

    const actorId = current.playerIds[current.currentPlayerIndex] as string;
    if (current.rollsLeft > 0) return { actorId, type: "roll", payload: {} };

    const open = openCategories(current, actorId);
    if (open.length === 0) return null;

    return { actorId, type: "score", payload: { category: pick(rng, open) } };
  },
  plantSecret: (state, marker) => ({
    ...(state as Record<string, Json>),
    // A field the module keeps but the view never publishes: the deck a
    // hidden-information ruleset would shuffle. It must not reach any viewer.
    deckOrder: [marker],
  }),
  secretMarker: "conformance-secret-deck-order",
  secretVisibility: "hidden-from-all",
  // Tables seat 2 to 5; `gameTable.softSeatCap` defaults to 4 and is a table
  // decision, not a module one (see the M0-7 findings note under docs/).
  playerCounts: { min: 2, max: 5 },
  maxIntentsToFinish: 400,
};

describeModuleConformance(yatzyModule, fixtures);
