import type { RawGameState, ViewerView } from "@roundhouse/game-core";
import { describe, expect, it } from "vitest";
import { yatzyModule } from "./module";
import type { YatzyState } from "./reduce";
import { projectYatzyView } from "./view";

const playerIds = ["p1", "p2", "p3"];

/** The published wire shape. A field missing here is a field clients cannot see. */
const PUBLIC_KEYS = [
  "currentPlayerId",
  "dice",
  "gameId",
  "holds",
  "phase",
  "playerIds",
  "rollsLeft",
  "ruleset",
  "sheets",
  "winnerIds",
  "you",
];

function raw(overrides: Partial<YatzyState> = {}): RawGameState {
  const state = {
    ...(yatzyModule.createInitialState({ ruleset: "yatzy" }, playerIds) as unknown as YatzyState),
    ...overrides,
  };

  return state as unknown as RawGameState;
}

function playerView(seatIndex: number, userId = playerIds[seatIndex]): ViewerView {
  return { kind: "player", seatIndex, userId };
}

const spectator: ViewerView = { kind: "spectator", userId: null };

describe("projectYatzyView", () => {
  it("exposes exactly the public fields", () => {
    expect(Object.keys(projectYatzyView(raw(), playerView(0))).sort()).toEqual(PUBLIC_KEYS);
  });

  it("does not leak an internal field added to YatzyState", () => {
    // Standing in for a hand of cards: hidden information that must never cross
    // the wire. The projection allowlists fields, so it cannot be spread out.
    const withSecret = raw({ ...({ deckOrder: ["ace", "king"] } as unknown as object) } as never);
    const view = projectYatzyView(withSecret, playerView(0)) as unknown as Record<string, unknown>;

    expect(view.deckOrder).toBeUndefined();
    expect(Object.keys(view).sort()).toEqual(PUBLIC_KEYS);
  });

  it("gives seated players views that differ only in `you`", () => {
    const state = raw({ currentPlayerIndex: 1, dice: [1, 2, 3, 4, 5], rollsLeft: 2 });

    const first = projectYatzyView(state, playerView(0));
    const second = projectYatzyView(state, playerView(2));

    expect(first.you).toBe(0);
    expect(second.you).toBe(2);
    expect({ ...first, you: null }).toEqual({ ...second, you: null });
  });

  it("gives a spectator the same board with no seat", () => {
    const state = raw();
    const seated = projectYatzyView(state, playerView(1));
    const watching = projectYatzyView(state, spectator);

    expect(watching.you).toBeNull();
    expect({ ...watching, you: null }).toEqual({ ...seated, you: null });
  });

  it("treats a signed-in non-seat as a spectator", () => {
    const view = projectYatzyView(raw(), { kind: "spectator", userId: "user-not-seated" });

    expect(view.you).toBeNull();
  });

  it("resolves currentPlayerId from the turn index", () => {
    expect(projectYatzyView(raw({ currentPlayerIndex: 2 }), spectator).currentPlayerId).toBe("p3");
    expect(projectYatzyView(raw({ currentPlayerIndex: 9 }), spectator).currentPlayerId).toBeNull();
  });

  it("carries the finished phase and winners through", () => {
    const view = projectYatzyView(
      raw({ phase: "finished", winnerIds: ["p2"], currentPlayerIndex: 1 }),
      playerView(1),
    );

    expect(view.phase).toBe("finished");
    expect(view.winnerIds).toEqual(["p2"]);
  });
});

describe("yatzyModule.projectStateFor", () => {
  it("is the same projection the view module exports", () => {
    const state = raw({ currentPlayerIndex: 1 });
    const viewer: ViewerView = { kind: "player", seatIndex: 1, userId: "p2" };

    expect(yatzyModule.projectStateFor(state, viewer)).toEqual(projectYatzyView(state, viewer));
  });
});
