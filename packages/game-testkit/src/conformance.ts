import type {
  EventEnvelope,
  GameModule,
  Json,
  RawGameState,
  ReduceContext,
  ViewerView,
} from "@roundhouse/game-core";
import { describe, expect, it } from "vitest";

import { assertJsonSafe, deepFreeze, serialize } from "./json";
import { mulberry32, type Rng, randomIntFrom } from "./rng";

/**
 * The module contract, as tests.
 *
 * `GameModule` says a lot in prose: `reduce` is pure, events carry outcomes,
 * projections are the only thing a client sees. Prose does not fail a build.
 * This suite turns each sentence into an assertion any module can adopt by
 * writing fixtures, so a second game cannot quietly play by weaker rules than
 * the first one (invariants I2, I3 and I5 in `docs/roadmap.md`).
 */

export type FixtureIntent = {
  actorId: string;
  type: string;
  payload: Json;
};

/**
 * `hidden-from-all`: nobody may see the planted marker (a shuffled deck, a
 * hidden role deck). `owner-only`: the seat that owns it may, everyone else
 * may not (a hand of cards).
 */
export type SecretVisibility = "hidden-from-all" | "owner-only";

/**
 * Everything the suite needs to know about one game. The only module-specific
 * code in the property test is `nextIntent`, which is deliberate: a generator
 * that lives in the testkit would encode one game's rules into every game's
 * test.
 */
export type ConformanceFixtures = {
  /** Passed to `createInitialState`; the suite never interprets it. */
  config: Json;
  /** Candidate player ids, at least `playerCounts.max` of them, all distinct. */
  playerIds: string[];
  /** Fixed clock for every `ctx.now()`; an ISO 8601 timestamp. */
  now: string;
  /** Legal intents in order, run from a fresh state by the determinism and purity checks. */
  script: readonly FixtureIntent[];
  /** Returns the next intent for a generated game, or null when the game is over. */
  nextIntent: (state: Json, rng: Rng) => FixtureIntent | null;
  /** Puts `marker` somewhere in the raw state that a projection must not expose. */
  plantSecret: (state: Json, marker: string) => Json;
  secretMarker: string;
  secretVisibility: SecretVisibility;
  playerCounts: { min: number; max: number };
  /** Safety valve for `nextIntent`; exceeding it fails the finish check with this number in the message. */
  maxIntentsToFinish: number;
};

/** The I3 property test plays at least this many generated games. */
export const REPLAY_GAMES = 200;

function validateFixtures(module: GameModule, fixtures: ConformanceFixtures): void {
  const require = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(`describeModuleConformance(${module.id}): ${message}`);
  };

  require(fixtures.playerIds.length > 0, "fixtures.playerIds must not be empty");
  require(new Set(fixtures.playerIds).size ===
    fixtures.playerIds
      .length, "fixtures.playerIds must be distinct (a seat is identified by its user)");
  require(Number.isInteger(fixtures.playerCounts.min) &&
    Number.isInteger(fixtures.playerCounts.max) &&
    fixtures.playerCounts.min >= 1 &&
    fixtures.playerCounts.min <=
      fixtures.playerCounts.max, "fixtures.playerCounts must satisfy 1 <= min <= max");
  require(fixtures.playerIds.length >=
    fixtures.playerCounts
      .max, `fixtures.playerIds must hold at least playerCounts.max (${fixtures.playerCounts.max}) ids`);
  require(fixtures.script.length > 0, "fixtures.script must hold at least one intent");
  require(fixtures.maxIntentsToFinish >
    0, "fixtures.maxIntentsToFinish must be a positive number of intents");
  require(!Number.isNaN(
    Date.parse(fixtures.now),
  ), "fixtures.now must be a parseable ISO 8601 timestamp");
  require(fixtures.secretMarker.length > 0, "fixtures.secretMarker must not be empty");
  require(Number.isInteger(module.playerCount.min) &&
    Number.isInteger(module.playerCount.max) &&
    module.playerCount.min >= 1 &&
    module.playerCount.min <=
      module.playerCount.max, "module.playerCount must satisfy 1 <= min <= max");
  require(fixtures.playerCounts.min === module.playerCount.min &&
    fixtures.playerCounts.max ===
      module.playerCount
        .max, `fixtures.playerCounts (${fixtures.playerCounts.min}-${fixtures.playerCounts.max}) must equal module.playerCount (${module.playerCount.min}-${module.playerCount.max})`);
  const defaultConfig = module.configSchema.safeParse(module.defaultConfig);
  require(defaultConfig.success, `module.defaultConfig must satisfy module.configSchema (${defaultConfig.success ? "" : defaultConfig.error.issues[0]?.message})`);
}

function contextFor(fixtures: ConformanceFixtures, actorId: string, rng: Rng): ReduceContext {
  return {
    actorId,
    randomInt: randomIntFrom(rng),
    now: () => new Date(fixtures.now),
    playerIds: fixtures.playerIds,
  };
}

/**
 * Module state and wire state are the same object; `RawGameState` is branded to
 * keep the server honest, not to change the data. Casting here is the seam the
 * brand exists to make visible (see the misfits write-up in `docs/`).
 */
function project(module: GameModule, state: Json, viewer: ViewerView): Json {
  return module.projectStateFor(state as unknown as RawGameState, viewer);
}

function envelope(
  event: Omit<EventEnvelope, "id" | "seq" | "createdAt">,
  seq: number,
  fixtures: ConformanceFixtures,
): EventEnvelope {
  return { ...event, id: `conformance-event-${seq}`, seq, createdAt: fixtures.now };
}

type Step = {
  state: Json;
  events: EventEnvelope[];
  rejections: string[];
};

function runScript(
  module: GameModule,
  fixtures: ConformanceFixtures,
  initialState: Json,
  intents: readonly FixtureIntent[],
  rng: Rng,
): Step {
  let state = initialState;
  const events: EventEnvelope[] = [];
  const rejections: string[] = [];

  for (const intent of intents) {
    const result = module.reduce(
      state,
      { type: intent.type, payload: intent.payload },
      contextFor(fixtures, intent.actorId, rng),
    );

    if (!result.ok) {
      rejections.push(`${intent.type} by ${intent.actorId}: ${result.error}`);
      continue;
    }

    for (const event of result.events) {
      events.push(envelope(event, events.length + 1, fixtures));
    }
    state = result.state;
  }

  return { state, events, rejections };
}

function playGame(
  module: GameModule,
  fixtures: ConformanceFixtures,
  seed: number,
  playerIds: string[],
): Step {
  const rng = mulberry32(seed);
  let state = assertJsonSafe(
    module.createInitialState(fixtures.config, playerIds),
    "createInitialState",
  );
  const events: EventEnvelope[] = [];

  for (let step = 0; step < fixtures.maxIntentsToFinish; step += 1) {
    const intent = fixtures.nextIntent(state, rng);
    if (!intent) break;

    const result = module.reduce(
      state,
      { type: intent.type, payload: intent.payload },
      contextFor(fixtures, intent.actorId, rng),
    );

    // A fixture that asks for an illegal move is a broken fixture, not a game
    // that ended; say so at the step it happened instead of at the replay.
    if (!result.ok) {
      throw new Error(
        `${module.id} rejected the fixture's own ${intent.type} for ${intent.actorId} at step ${step} (seed ${seed}): ${result.error}`,
      );
    }

    for (const event of result.events) {
      events.push(envelope(event, events.length + 1, fixtures));
    }
    state = assertJsonSafe(result.state, `reduce state at step ${step} (seed ${seed})`);
  }

  return { state, events, rejections: [] };
}

function replay(module: GameModule, initialState: Json, events: readonly EventEnvelope[]): Json {
  let state = initialState;
  for (const event of events) {
    state = assertJsonSafe(
      module.applyEvent(state, event),
      `applyEvent ${event.type} at seq ${event.seq}`,
    );
  }
  return state;
}

function viewersFor(fixtures: ConformanceFixtures): ViewerView[] {
  return [
    ...fixtures.playerIds.map(
      (userId, seatIndex): ViewerView => ({ kind: "player", userId, seatIndex }),
    ),
    // A player row that names no seat: the viewer can exist before the table does.
    { kind: "player", userId: "conformance-stranger", seatIndex: -1 },
    { kind: "spectator", userId: null },
    { kind: "spectator", userId: fixtures.playerIds[0] as string },
  ];
}

function labelViewer(viewer: ViewerView): string {
  return viewer.kind === "player"
    ? `player ${viewer.userId} (seat ${viewer.seatIndex})`
    : `spectator ${viewer.userId ?? "anonymous"}`;
}

/** Runs `run` with the ambient clock and RNG replaced by throwers. */
function withoutClockOrRandomness<T>(run: () => T): T {
  const random = Math.random;
  const now = Date.now;

  Math.random = () => {
    throw new Error("the module called Math.random; randomness must come from ctx.randomInt");
  };
  Date.now = () => {
    throw new Error("the module called Date.now; the clock must come from ctx.now");
  };

  try {
    return run();
  } finally {
    Math.random = random;
    Date.now = now;
  }
}

/**
 * Throws naming every viewer whose projection contains the planted marker, so a
 * module that leaks a deck or a hand fails with the seat that saw it. Exported
 * because the testkit proves it *can* fail: `conformance.test.ts` points it at a
 * deliberately leaky module.
 */
export function assertProjectionHidesSecret(
  module: GameModule,
  fixtures: ConformanceFixtures,
  baseState?: Json,
): void {
  // Both entry points validate the module's own declaration, so a module cannot
  // claim a seat range its fixtures never cover by being checked with the
  // narrower export.
  validateFixtures(module, fixtures);

  const state =
    baseState ??
    assertJsonSafe(
      module.createInitialState(
        fixtures.config,
        fixtures.playerIds.slice(0, fixtures.playerCounts.min),
      ),
      "createInitialState",
    );

  const planted = assertJsonSafe(
    fixtures.plantSecret(state, fixtures.secretMarker),
    "plantSecret state",
  );
  if (!serialize(planted).includes(fixtures.secretMarker)) {
    throw new Error(
      `describeModuleConformance(${module.id}): fixtures.plantSecret did not put "${fixtures.secretMarker}" into the state, so the leak check would prove nothing`,
    );
  }

  const owner = fixtures.playerIds[0];
  const offenders = viewersFor(fixtures)
    .filter((viewer) => {
      if (fixtures.secretVisibility === "owner-only" && viewer.kind === "player") {
        if (viewer.userId === owner) return false;
      }
      return serialize(project(module, planted, viewer)).includes(fixtures.secretMarker);
    })
    .map(labelViewer);

  if (offenders.length > 0) {
    throw new Error(
      `${module.id} leaks "${fixtures.secretMarker}" to ${offenders.join(", ")}; a projection must omit it for these viewers (secretVisibility: ${fixtures.secretVisibility})`,
    );
  }
}

/**
 * Declares the whole conformance suite for one module. Call it once, at the top
 * level of a `*.test.ts` in the module's own package.
 */
export function describeModuleConformance(module: GameModule, fixtures: ConformanceFixtures): void {
  validateFixtures(module, fixtures);

  const players = (count: number): string[] => fixtures.playerIds.slice(0, count);
  const initialStateFor = (count: number): Json =>
    assertJsonSafe(
      module.createInitialState(fixtures.config, players(count)),
      "createInitialState",
    );

  const minPlayers = fixtures.playerCounts.min;
  const maxPlayers = fixtures.playerCounts.max;

  describe(`${module.id} conforms to the module contract`, () => {
    it("creates a JSON-safe state for the smallest and largest table, deterministically", () => {
      const smallest = initialStateFor(minPlayers);
      const largest = initialStateFor(maxPlayers);

      expect(serialize(smallest)).toBe(serialize(initialStateFor(minPlayers)));
      expect(module.isFinished(smallest)).toBe(false);
      expect(module.isFinished(largest)).toBe(false);
    });

    it("never reaches for the ambient clock or RNG", () => {
      // Patching the globals is the only way to catch a call site the module
      // forgot to route through `ctx`: a returned value looks identical.
      withoutClockOrRandomness(() => {
        runScript(module, fixtures, initialStateFor(minPlayers), fixtures.script, mulberry32(1));
        playGame(module, fixtures, 7, players(minPlayers));
      });
    });

    it("does not mutate the state it is handed", () => {
      let state = initialStateFor(minPlayers);

      for (const intent of fixtures.script) {
        const before = serialize(state);
        // A frozen copy, so a mutation throws instead of quietly succeeding; the
        // JSON comparison still catches a module that mutates a clone it kept.
        const handed = deepFreeze(JSON.parse(before) as Json);
        const result = module.reduce(
          handed,
          { type: intent.type, payload: intent.payload },
          contextFor(fixtures, intent.actorId, mulberry32(3)),
        );

        expect(serialize(handed), `${intent.type} mutated the state it was given`).toBe(before);
        if (result.ok) state = assertJsonSafe(result.state, `${intent.type} result`);
      }
    });

    it("produces the same state and events for the same inputs", () => {
      const first = runScript(
        module,
        fixtures,
        initialStateFor(minPlayers),
        fixtures.script,
        mulberry32(42),
      );
      const second = runScript(
        module,
        fixtures,
        initialStateFor(minPlayers),
        fixtures.script,
        mulberry32(42),
      );

      expect(serialize(second.state)).toBe(serialize(first.state));
      expect(serialize(second.events)).toBe(serialize(first.events));
      expect(second.rejections).toEqual(first.rejections);
    });

    it(`replays ${REPLAY_GAMES} generated games back to the state reduce produced`, () => {
      // I3: the log is the game. If folding the events a module emitted does not
      // reproduce the state it returned, the log cannot be replayed, resumed, or
      // trusted as the record of what happened (ADR 0002).
      for (let game = 1; game <= REPLAY_GAMES; game += 1) {
        const start = initialStateFor(minPlayers);
        const played = playGame(module, fixtures, game, players(minPlayers));
        const folded = replay(module, start, played.events);

        expect(
          serialize(folded),
          `seed ${game}: folding ${played.events.length} events did not reproduce the state reduce returned`,
        ).toBe(serialize(played.state));
      }
    }, 120_000);

    it("projects a JSON-safe, deterministic view for every kind of viewer", () => {
      const played = runScript(
        module,
        fixtures,
        initialStateFor(maxPlayers),
        fixtures.script,
        mulberry32(5),
      );
      const before = serialize(played.state);
      const handed = deepFreeze(JSON.parse(before) as Json);

      for (const viewer of viewersFor(fixtures)) {
        const label = labelViewer(viewer);
        const view = assertJsonSafe(project(module, handed, viewer), `projection for ${label}`);

        expect(
          serialize(project(module, handed, viewer)),
          `${label} projection is not deterministic`,
        ).toBe(serialize(view));
      }

      expect(serialize(handed), "projectStateFor mutated the state it was given").toBe(before);
    });

    it("keeps the fixture's secret out of every projection that must not see it", () => {
      expect(() => assertProjectionHidesSecret(module, fixtures)).not.toThrow();
    });

    it(`finishes a ${minPlayers}-player game within the intent budget`, () => {
      for (const seed of [11, 12, 13]) {
        const played = playGame(module, fixtures, seed, players(minPlayers));
        expect(
          module.isFinished(played.state),
          `seed ${seed}: a ${minPlayers}-player game did not finish within fixtures.maxIntentsToFinish (${fixtures.maxIntentsToFinish})`,
        ).toBe(true);
      }
    });
  });
}
