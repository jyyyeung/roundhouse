import type { Json } from "@roundhouse/game-core";
import {
  type ConformanceFixtures,
  describeModuleConformance,
  type FixtureIntent,
  pick,
} from "@roundhouse/game-testkit";

import { duelModule } from "./module";
import { DUEL_CARDS, type DuelState } from "./reduce";

/**
 * Duel's fixtures for the shared conformance suite (invariant I5).
 *
 * This is the first module whose projection hides something from somebody other
 * than "everyone": the pending pick is `owner-only`, so the suite fails unless
 * `projectDuelView` hides it from the opponent, the stranger row and both kinds
 * of spectator while still showing it to the seat that made it.
 */
const PLAYERS = ["alice", "bob"];

const fixtures: ConformanceFixtures = {
  config: { rounds: 3, tableId: "conformance-table" },
  playerIds: PLAYERS,
  now: "2026-01-01T00:00:00.000Z",
  // A legal six-intent match: every card legally playable, ending 3-0 on rounds
  // (no tie-break roll, so the scripted run does not depend on the RNG).
  script: [
    { actorId: "alice", payload: { card: "strike" }, type: "play" },
    { actorId: "bob", payload: { card: "feint" }, type: "play" },
    { actorId: "alice", payload: { card: "guard" }, type: "play" },
    { actorId: "bob", payload: { card: "strike" }, type: "play" },
    { actorId: "alice", payload: { card: "strike" }, type: "play" },
    { actorId: "bob", payload: { card: "feint" }, type: "play" },
  ],
  nextIntent: (state, rng): FixtureIntent | null => {
    const current = state as unknown as DuelState;
    if (current.phase === "finished") return null;

    const actorId = current.playerIds.find((playerId) => current.pending[playerId] === undefined);
    if (!actorId) return null;

    return { actorId, payload: { card: pick(rng, DUEL_CARDS) }, type: "play" };
  },
  plantSecret: (state, marker) => {
    const current = state as unknown as DuelState;
    const [owner] = current.playerIds as [string];

    return {
      ...(state as Record<string, Json>),
      // Where a real secret lives: the pick waiting for the other seat.
      pending: { ...current.pending, [owner]: marker },
    };
  },
  secretMarker: "conformance-secret-pending-pick",
  secretVisibility: "owner-only",
  // Must equal `duelModule.playerCount`: the suite fails when the fixtures and
  // the module disagree about how many players the game has rules for.
  playerCounts: { min: 2, max: 2 },
  // Three rounds of two picks is six intents; the budget leaves room to spare.
  maxIntentsToFinish: 12,
};

describeModuleConformance(duelModule, fixtures);
