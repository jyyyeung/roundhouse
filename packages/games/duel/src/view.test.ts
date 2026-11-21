import type { RawGameState, ViewerView } from "@roundhouse/game-core";
import { describe, expect, it } from "vitest";

import { createDuelState, type DuelState, reduce } from "./reduce";
import { projectDuelView } from "./view";

const PLAYERS = ["alice", "bob"];

function raw(state: DuelState): RawGameState {
  return state as unknown as RawGameState;
}

const alice: ViewerView = { kind: "player", seatIndex: 0, userId: "alice" };
const bob: ViewerView = { kind: "player", seatIndex: 1, userId: "bob" };
const spectator: ViewerView = { kind: "spectator", userId: null };

/** One round where alice has picked and bob has not: the interesting moment. */
function halfway() {
  const initial = createDuelState({ rounds: 3 }, PLAYERS);
  const result = reduce(
    initial as never,
    { payload: { card: "strike" }, type: "play" },
    {
      actorId: "alice",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      playerIds: PLAYERS,
      randomInt: () => 0,
    },
  );
  if (!result.ok) throw new Error(result.error);
  return result.state as unknown as DuelState;
}

describe("duel projection", () => {
  it("shows the picker their own card and nobody else's", () => {
    const state = halfway();

    expect(projectDuelView(raw(state), alice).yourPick).toBe("strike");
    expect(projectDuelView(raw(state), bob).yourPick).toBeNull();
    expect(projectDuelView(raw(state), spectator).yourPick).toBeNull();
  });

  it("never puts the opponent's pending card anywhere on their wire", () => {
    const state = halfway();
    const bobWire = JSON.stringify(projectDuelView(raw(state), bob));

    expect(bobWire).not.toContain("strike");
    // The fact that alice has chosen is public: that is tempo, not information.
    expect(projectDuelView(raw(state), bob).pickedBy).toEqual(["alice"]);
  });

  it("publishes the viewer's seat and keeps spectators seatless", () => {
    const state = halfway();

    expect(projectDuelView(raw(state), alice).you).toBe(0);
    expect(projectDuelView(raw(state), bob).you).toBe(1);
    expect(projectDuelView(raw(state), spectator).you).toBeNull();
    expect(projectDuelView(raw(state), spectator).playerIds).toEqual(PLAYERS);
  });

  it("gives both seats an identical view once the round is revealed", () => {
    const state = halfway();
    const resolved = reduce(
      state as never,
      { payload: { card: "guard" }, type: "play" },
      {
        actorId: "bob",
        now: () => new Date("2026-01-01T00:00:00.000Z"),
        playerIds: PLAYERS,
        randomInt: () => 0,
      },
    );
    if (!resolved.ok) throw new Error(resolved.error);

    const aliceView = projectDuelView(raw(resolved.state as unknown as DuelState), alice);
    const bobView = projectDuelView(raw(resolved.state as unknown as DuelState), bob);

    expect(aliceView.rounds).toEqual(bobView.rounds);
    expect(aliceView.rounds[0]?.plays).toEqual([
      { card: "strike", playerId: "alice" },
      { card: "guard", playerId: "bob" },
    ]);
    expect(aliceView.scores).toEqual({ alice: 0, bob: 1 });
  });

  it("treats a seat index with no player behind it as a spectator", () => {
    const state = halfway();
    const stray: ViewerView = { kind: "player", seatIndex: 9, userId: "nobody" };

    expect(projectDuelView(raw(state), stray).you).toBeNull();
    expect(projectDuelView(raw(state), stray).yourPick).toBeNull();
  });

  it("hides a marker planted in the pending pick from every other viewer", () => {
    const state = halfway();
    const planted = {
      ...state,
      pending: { ...state.pending, alice: "MARKER" },
    } as unknown as DuelState;

    expect(projectDuelView(raw(planted), alice).yourPick).toBe("MARKER");
    expect(JSON.stringify(projectDuelView(raw(planted), bob))).not.toContain("MARKER");
    expect(JSON.stringify(projectDuelView(raw(planted), spectator))).not.toContain("MARKER");
  });

  it("does not hand out references to the state it is given", () => {
    const state = halfway();
    const view = projectDuelView(raw(state), alice);

    view.playerIds.push("mallory");
    view.scores.alice = 99;
    view.winnerIds.push("mallory");

    expect(state.playerIds).toEqual(PLAYERS);
    expect(state.scores).toEqual({ alice: 0, bob: 0 });
    expect(state.winnerIds).toEqual([]);
  });
});
