import type { GameModule, RawGameState } from "@roundhouse/game-core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { projectSnapshot, rawGameState, viewerForUser } from "./projection";

function fakeModule(projectStateFor: GameModule["projectStateFor"]): GameModule {
  return {
    applyEvent: (state) => state,
    configSchema: z.object({}).loose(),
    createInitialState: () => null,
    defaultConfig: {},
    displayName: "Fake",
    id: "fake",
    playerCount: { max: 4, min: 2 },
    intents: {},
    isFinished: () => false,
    projectStateFor,
    reduce: (state) => ({ events: [], ok: true, state }),
  };
}

describe("viewerForUser", () => {
  const seats = ["user-a", "user-b"];

  it("gives an anonymous socket a spectator with no identity", () => {
    expect(viewerForUser(seats, null)).toEqual({ kind: "spectator", userId: null });
  });

  it("gives a seated user their seat index", () => {
    expect(viewerForUser(seats, "user-b")).toEqual({
      kind: "player",
      seatIndex: 1,
      userId: "user-b",
    });
  });

  it("gives a signed-in non-seat a spectator view that names the user", () => {
    expect(viewerForUser(seats, "user-z")).toEqual({ kind: "spectator", userId: "user-z" });
  });
});

describe("projectSnapshot", () => {
  it("returns null for a table with no game, without consulting the module", () => {
    const projectStateFor = vi.fn();
    const module = fakeModule(projectStateFor);

    expect(projectSnapshot(module, null, { kind: "spectator", userId: null })).toBeNull();
    expect(projectStateFor).not.toHaveBeenCalled();
  });

  it("delegates to the module projection and returns its payload untouched", () => {
    const module = fakeModule(() => ({ dice: [1, 2, 3] }));
    const state = { secret: "hidden" } as unknown as RawGameState;

    const projected = projectSnapshot(module, state, { kind: "player", seatIndex: 0, userId: "u" });

    expect(projected).toEqual({ dice: [1, 2, 3] });
  });

  it("hands the module the raw state and the viewer it was given", () => {
    const projectStateFor = vi.fn(() => ({ ok: true }));
    const module = fakeModule(projectStateFor);
    const state = { secret: "hidden" } as unknown as RawGameState;
    const viewer = { kind: "player", seatIndex: 0, userId: "u" } as const;

    projectSnapshot(module, state, viewer);

    expect(projectStateFor).toHaveBeenCalledWith(state, viewer);
  });

  it("cannot leak a field the module projection omits", () => {
    // The whole point of the choke point: whatever the module allowlists is the
    // only thing that can appear, whatever the stored jsonb happens to contain.
    const module = fakeModule(() => ({ dice: [0, 0, 0, 0, 0] }));
    const state = { deckOrder: ["ace", "king"], dice: [0, 0, 0, 0, 0] } as unknown as RawGameState;

    const serialised = JSON.stringify(
      projectSnapshot(module, state, { kind: "spectator", userId: null }),
    );

    expect(serialised).not.toContain("deckOrder");
    expect(serialised).not.toContain("ace");
  });
});

describe("rawGameState", () => {
  it("maps a missing game to null and passes a stored state through", () => {
    const state = { dice: [0, 0, 0, 0, 0] };

    expect(rawGameState(null)).toBeNull();
    expect(rawGameState(undefined)).toBeNull();
    expect(rawGameState(state)).toBe(state);
  });
});
