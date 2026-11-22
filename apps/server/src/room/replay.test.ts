import type {
  EventEnvelope,
  GameModule,
  Json,
  ReplayTurn,
  ViewerView,
} from "@roundhouse/game-core";
import { duelModule } from "@roundhouse/game-duel";
import { yatzyModule } from "@roundhouse/game-yatzy";
import { describe, expect, it } from "vitest";

import { viewerForUser } from "./projection";
import { buildReplay } from "./replay";

const SEATS = ["ann", "bob"];
const START = new Date("2026-11-22T00:00:00.000Z");

/** The view of the last step, read as the wire sees it. */
function viewOf(turns: ReplayTurn[]): Record<string, unknown> {
  const last = turns.at(-1)?.view;
  if (last === undefined) throw new Error("the replay produced no steps");
  return last as Record<string, unknown>;
}

function envelope(partial: Partial<EventEnvelope> & Pick<EventEnvelope, "payload" | "type">) {
  return {
    actorId: "ann",
    createdAt: START.toISOString(),
    gameId: "yatzy",
    id: `event-${partial.seq ?? 0}`,
    seq: 1,
    tableId: "table-1",
    ...partial,
  } as EventEnvelope;
}

/**
 * Plays a scripted yatzy game and returns the log the way the runtime writes it:
 * one envelope per reduce event, `seq` increasing from 1.
 */
function scriptedGame() {
  const module = yatzyModule;
  const initialState = module.createInitialState(
    { ruleset: "yatzy", tableId: "table-1" } as Json,
    SEATS,
  );

  const events: EventEnvelope[] = [];
  let state = initialState;
  let actor = SEATS[0] as string;
  let seq = 0;

  const play = (intent: { type: string; payload: Json }) => {
    const result = module.reduce(state, intent, {
      actorId: actor,
      now: () => START,
      playerIds: SEATS,
      randomInt: () => 0,
    });
    if (!result.ok) throw new Error(`scripted intent failed: ${result.error}`);
    state = result.state;
    for (const event of result.events) {
      seq += 1;
      events.push(envelope({ ...event, actorId: event.actorId, seq }));
    }
  };

  play({ payload: {}, type: "roll" });
  play({ payload: { holds: [true, true, true, true, true] }, type: "set_holds" });
  play({ payload: { category: "ones" }, type: "score" });
  actor = SEATS[1] as string;
  play({ payload: {}, type: "roll" });

  return { events, finalState: state, initialState, module };
}

/** A module with nothing but what replay needs, to pin the optional-hook paths. */
const plainModule: GameModule = {
  applyEvent(state, event) {
    const payload = event.payload as { by?: number };
    return { count: ((state as { count: number }).count ?? 0) + (payload.by ?? 0) };
  },
  configSchema: { parse: (value: unknown) => value } as GameModule["configSchema"],
  createInitialState: () => ({ count: 0 }),
  defaultConfig: {},
  displayName: "Plain",
  id: "plain",
  intents: {},
  isFinished: () => false,
  playerCount: { max: 4, min: 1 },
  projectStateFor(state, viewer) {
    return { count: (state as unknown as { count: number }).count, viewer: viewer.kind };
  },
  reduce: () => ({ error: "nope", ok: false }),
};

describe("buildReplay", () => {
  it("folds the log into one step per action and ends on the final board", () => {
    const { events, finalState, initialState, module } = scriptedGame();
    const viewer = viewerForUser(SEATS, "ann");

    const turns = buildReplay({ events, initialState, module, viewer });

    // roll, hold, score, roll — `turn_advanced` is bookkeeping and earns no step.
    expect(turns.map((turn) => turn.phrase)).toEqual([
      "rolled 1 1 1 1 1",
      "held 5 dice",
      "scored ones for 5",
      "rolled 1 1 1 1 1",
    ]);
    expect(turns.map((turn) => turn.seq)).toEqual([1, 2, 3, 5]);
    expect(turns.at(-1)?.view).toEqual(module.projectStateFor(finalState as never, viewer));
  });

  it("projects every step for the viewer, so seats differ only in `you`", () => {
    const { events, initialState, module } = scriptedGame();

    const ann = buildReplay({
      events,
      initialState,
      module,
      viewer: viewerForUser(SEATS, "ann"),
    });
    const bob = buildReplay({
      events,
      initialState,
      module,
      viewer: viewerForUser(SEATS, "bob"),
    });

    expect(viewOf(ann).you).toBe(0);
    expect(viewOf(bob).you).toBe(1);
    expect({ ...viewOf(ann), you: null }).toEqual({ ...viewOf(bob), you: null });
  });

  it("gives a spectator the same steps with no seat", () => {
    const { events, initialState, module } = scriptedGame();

    const turns = buildReplay({
      events,
      initialState,
      module,
      viewer: { kind: "spectator", userId: "watcher" } satisfies ViewerView,
    });

    expect(viewOf(turns).you).toBeNull();
    expect(turns).toHaveLength(4);
  });

  it("returns the starting board for an empty log", () => {
    const turns = buildReplay({
      events: [],
      initialState: { count: 0 },
      module: plainModule,
      viewer: { kind: "spectator", userId: null },
    });

    expect(turns).toEqual([
      { actorId: null, phrase: "game started", seq: 0, view: { count: 0, viewer: "spectator" } },
    ]);
  });

  it("falls back to the humanised event type when a module cannot describe it", () => {
    const events = [
      envelope({ payload: { by: 2 }, seq: 1, type: "two_added" }),
      envelope({ payload: { by: 3 }, seq: 2, type: "three_added" }),
    ];

    const turns = buildReplay({
      events,
      initialState: { count: 0 },
      module: plainModule,
      viewer: { kind: "spectator", userId: null },
    });

    expect(turns.map((turn) => turn.phrase)).toEqual(["two added", "three added"]);
  });

  it("skips bookkeeping steps but still lands on the final board", () => {
    const describing: GameModule = {
      ...plainModule,
      describeEvent: (event) => (event.type === "tick" ? null : `${event.type} happened`),
    };
    const events = [
      envelope({ payload: { by: 1 }, seq: 1, type: "added" }),
      envelope({ payload: { by: 5 }, seq: 2, type: "tick" }),
    ];

    const turns = buildReplay({
      events,
      initialState: { count: 0 },
      module: describing,
      viewer: { kind: "spectator", userId: null },
    });

    expect(turns.map((turn) => [turn.seq, turn.phrase])).toEqual([
      [1, "added happened"],
      [2, "final position"],
    ]);
    expect(viewOf(turns).count).toBe(6);
  });

  it("replays five hundred events well inside the budget", () => {
    const events = Array.from({ length: 500 }, (_, index) =>
      envelope({ payload: { by: 1 }, seq: index + 1, type: "added" }),
    );
    const started = performance.now();

    const turns = buildReplay({
      events,
      initialState: { count: 0 },
      module: plainModule,
      viewer: { kind: "spectator", userId: null },
    });

    expect(turns).toHaveLength(500);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("buildReplay on a hidden-information game", () => {
  /** Alice has picked; bob has not. The log holds the pick, never the card. */
  function pendingDuel() {
    const initialState = duelModule.createInitialState(
      { rounds: 3, tableId: "table-1" } as Json,
      SEATS,
    );
    const result = duelModule.reduce(
      initialState,
      { payload: { card: "strike" }, type: "play" },
      { actorId: SEATS[0] as string, now: () => START, playerIds: SEATS, randomInt: () => 0 },
    );
    if (!result.ok) throw new Error(`scripted pick failed: ${result.error}`);
    const events = result.events.map((event, index) => envelope({ ...event, seq: index + 1 }));
    return { events, initialState };
  }

  it("never puts a payload or an unrevealed card on the wire", () => {
    const { events, initialState } = pendingDuel();

    const turns = buildReplay({
      events,
      initialState,
      module: duelModule,
      viewer: viewerForUser(SEATS, SEATS[1] as string),
    });

    const body = JSON.stringify(turns);
    expect(body).not.toContain("payload");
    expect(body).not.toContain("strike");
    // A pick is not a scrubber step: nothing was revealed yet.
    expect(turns.map((turn) => turn.phrase)).toEqual(["final position"]);
    expect(turns[0]?.view).toEqual(
      duelModule.projectStateFor(
        duelModule.applyEvent(initialState, events[0] as EventEnvelope) as never,
        viewerForUser(SEATS, SEATS[1] as string),
      ),
    );
  });
});
