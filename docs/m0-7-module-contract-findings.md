# M0-7 findings: what a hidden-information game demands of `GameModule`

Milestone M0, issue #17. Invariants I2 (reduce is pure), I3 (the event log replays) and I5 (every
module passes conformance) in [`docs/roadmap.md`](../roadmap.md).

## What was built, and what was thrown away

**Kept:** `packages/game-testkit` — `describeModuleConformance(module, fixtures)` declares eight
tests from a fixture object, so a new game adopts the contract by writing fixtures, not by copying
yatzy's suite:

| test                                                                                    | invariant | what it catches                                                       |
| --------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------- |
| `createInitialState` is JSON-safe and deterministic, for the smallest and largest table | I6        | a `Date`, a `Map`, a seat without a sheet                             |
| never reaches for the ambient clock or RNG                                              | I2        | `Math.random()` inside `reduce`, `Date.now()` in a timeout rule       |
| does not mutate the state it is handed                                                  | I2        | in-place `state.dice[0] = 6`, which corrupts any concurrent read      |
| same inputs, same state and events                                                      | I2        | iteration over an unordered object, `Set` iteration order             |
| replays 200 generated games back to the state `reduce` produced                         | I3        | an event that drops an outcome (`dice_rolled` with an empty payload)  |
| projects a JSON-safe, deterministic view for every viewer kind                          | I1        | `undefined` fields, a `Date`, a projection that depends on wall-clock |
| keeps the fixture's secret out of every projection that must not see it                 | I1        | a deck or a hand reaching the wrong seat                              |
| finishes a smallest-table game inside the intent budget                                 | —         | a ruleset that deadlocks, a generator that never terminates           |

The fixture object is the only module-specific code: `config`, `playerIds`, `now`, a short `script`
of legal intents, `nextIntent(state, rng)`, `plantSecret(state, marker)`, `secretMarker`,
`secretVisibility` (`hidden-from-all` | `owner-only`), `playerCounts`, `maxIntentsToFinish`.

Two structural decisions worth naming:

- **`nextIntent` lives in the fixtures, not in the testkit.** A generator that ships with the
  testkit would encode one game's rules into every game's property test.
- **The leak check proves it can fail.** `assertProjectionHidesSecret` is exported, and
  `packages/game-testkit/src/conformance.test.ts` points it at a module that publishes the planted
  secret and asserts the throw. The same self-check runs the whole suite against a second, unrelated
  game (`src/test-support/tally.ts`), so a yatzy-shaped assumption in the suite breaks the testkit's
  own tests. A test that cannot fail is worse than no test.

**Thrown away before merge:** `packages/games/spike` — "Vault", a four-player game with private
hands and a face-down deck (`draw` adds the top card to your hand, `bank` scores and empties it).
It passed all eight suite tests unmodified; the misfit list below is what writing it cost.

Run it:

```
pnpm -r test                                          # suite runs inside yatzy's own tests
pnpm --filter @roundhouse/game-testkit test            # the testkit's self-check
```

## Findings

Each finding is either **amended** (the contract is changed, and the ADR says how) or **filed**
(recorded on the roadmap because it belongs to a later milestone).

### F1 — `GameModule` does not declare seat limits, and should not · amended (ADR 0001)

ADR 0001's decision sketch declared `seatLimits: { min: number; max: number }`. The interface that
shipped has no such field, and the spike did not want one:

- seat limits are a **table** decision, already modelled and enforced at the table layer —
  `gameTable.softSeatCap` in `apps/server/src/db/schema.ts`, with `table_full` and
  `not_enough_players` raised by `apps/server/src/room/runtime.ts` and covered by the Postgres-backed
  tests in `apps/server/src/room/runtime.integration.test.ts`;
- a module that declares limits would duplicate that number, and the two would drift;
- the conformance suite needs _some_ seat count to test extremes, and fixtures already supply
  `playerCounts`. That is the honest place for it: what the module can play, not what a table allows.

### F2 — events are projected per viewer on the wire, but their payloads are not · filed (blocker for M5-1)

This is the finding the spike was written to produce. State is projected per socket; events are not.

- `apps/server/src/ws/hub.ts:389` — inside `publishApplied`'s per-socket loop, `events: input.events`
  sends the same raw event list to every seat while `state` on the very next line is
  `projectSnapshot(module, input.state, viewer)`.
- `apps/server/src/ws/hub.ts:283` — `sendSyncFrame` does the same for replayed ranges:
  `events: result.events` alongside a projected `state`.

Vault's `draw` emits `card_drawn { playerId, card, deckCount }`. Every seated client receives
`card`, so the private hand is public one frame after the draw. The state projection is correct and
irrelevant: the leak is in the stream next to it.

The replay contract (ADR 0002) needs the event payload to be complete — `applyEvent` must reproduce
private state. That is exactly why the wire cannot carry it as-is. The shape of the fix belongs to
M5-1 (second title with hidden information) but the decision must be made before that title ships:

1. **`projectEventFor(viewer, event)` on the module** — same allowlist discipline as
   `projectStateFor`, one new method, one new seam rule in `scripts/check-projection.mjs`; the client
   then folds nothing and renders projected state.
2. **Stop sending event payloads; send a public event projection** — rename the frame field, keep
   `type` + `actorId` + a projection, and let the log live only server-side (it already does: replay
   reads `game_event`, not the wire).
3. **Per-viewer framing** — the hub already loops per socket, so the change is local to
   `publishApplied` and `sendSyncFrame`; no protocol version bump is needed for (1) or (2) because
   `v: 2` clients only read `state` for rendering today.

Filed as a roadmap blocker rather than fixed here: no shipping module has hidden information yet, and
the fix belongs to the first one that does.

### F3 — `RawGameState` is unusable from where module state is created · amended (ADR 0001)

`projectStateFor(state: RawGameState, viewer)` is the only signature that names the brand, but a
module's state is built as `Json` (`createInitialState`, `reduce`), so every module writes

```ts
function projectStateFor(state: RawGameState, viewer: ViewerView) {
  return projectYatzyView(state, viewer) as unknown as Json;
}
```

and the spike writes the mirror cast `state as unknown as VaultState` **inside** `projectStateFor`,
where the brand is supposed to make that impossible. The brand protects the server from itself; it
does not describe module internals. It cannot: `GameModule` is not generic, and making it generic
(`GameModule<S>`) would push a type parameter through the registry, the runtime, and both packages.

Amended position: the brand marks _server-owned state that must not be serialised directly_, and the
module is the thing that owns (and may name) the raw shape. The guard, not the brand, is what stops a
leak: `scripts/check-projection.mjs` forbids casting or naming `RawGameState` outside the seam. A
future `GameModule<S>` remains open if a third module makes the casts painful enough to pay for it.

### F4 — `createInitialState` has no context, so a module cannot deal or shuffle · filed (M5-1)

`createInitialState(config: Json, playerIds: string[]): Json` receives no `ReduceContext`, so it has
no `randomInt` and no clock. The spike's deck therefore had to be deterministic
(`[40, 39, …, 1]`), which is not a card game.

Today a real shuffled deck has only two homes: the server supplies the deal in `config` (putting
hidden information in the table row, and making the same table replay differently per creation), or
the first intent shuffles and deals (making one intent special and emitting a large hidden payload in
a public event — see F2). Both are bad. Options for M5-1: pass `ctx` to `createInitialState`, or
introduce a `setup` intent whose events are already private by construction.

### F5 — `ViewerView` carries two identities and says which one wins nowhere · amended (ADR 0001)

`{ kind: "player"; userId: string; seatIndex: number }`. Yatzy projects from `seatIndex`
(`viewer.kind === "player" ? viewer.seatIndex : null`); the spike projects by `raw.playerIds.indexOf(viewer.userId)`
and ignores `seatIndex`. Both are reasonable; a server that ever sends a stale `seatIndex` (or a
`-1`) will get a wrong projection from one of them and a right one from the other.

Amended position: `seatIndex` is authoritative for a seated player and is only ever produced from the
`table_player` row the server just read; `userId` names who is asking (chat attribution, `you`
highlighting) and must not be the sole input to a visibility decision. The projection guard does not
enforce this — it is a review rule, stated here so it is reviewable.

### F6 — a projection can contain `undefined` and TypeScript will not notice · lesson

The spike's first projection carried `noYourHand: undefined`. It typechecks (`as unknown as Json`),
serialises to nothing, and the wire schema would have accepted it — a field the client can read as
`undefined` and the server believes it sent. The suite caught it on the first run:

```
projection for player alice (seat 0).noYourHand is undefined (undefined), which JSON cannot represent
```

That is the JSON walk in `packages/game-testkit/src/json.ts` earning its place: the round trip alone
would have silently dropped the key. Follow-up worth considering when the wire schemas gain
projection types: make a module's projection parse through its own Zod schema (M0-1 pattern) so the
server validates before send, not after.

### F7 — chat history stores the sender's projection, which is a hand in a hidden-information game · filed (M2-1/M5-1)

`apps/server/src/ws/persistence.ts:32` persists `snapshot` on every chat message, and the snapshot is
the **sending viewer's** projection (recorded as a follow-up in ADR 0001's M0-2 notes). For yatzy it
is harmless — the chat chip shows dice and holds. For Vault it means the sender's hand is written
into shared history and replayed to everyone when the chat page loads. The fix is small (store a
spectator projection, or store nothing and render chips from the client's current state) but it must
land with M2-1, before the first hidden-information title.

## What the suite cannot express (deliberate limits)

Written down so the next module author does not assume coverage that is not there:

- **One planted secret per run.** `plantSecret` marks one place; a game with a secret per seat is
  checked for the owner's secret only. Extending to N markers is mechanical, and worth doing when a
  second hidden-information module exists to need it.
- **No wire-level checks.** The suite tests modules, not the hub: F2 is invisible to it by design.
  A hub-level test would need a fake socket and a table, which is the integration suite's job (#15).
- **No "who may act now" assertion.** Turn order is inside `reduce`, and legality is the generator's
  problem (`nextIntent` throws if the module rejects a generated intent). Async play (M3) will want
  the module to _answer_ that question, not just enforce it.
- **No shape stability check.** Two viewers may project different key sets (spectator without `you`)
  and the suite allows it; only JSON-safety, totality and determinism are asserted.

## Verdict

Yatzy passes unmodified. A second, hidden-information game passed unmodified with three documented
casts and a deterministic deck. The contract is adequate for turn-based games _inside_ a module, and
inadequate at the wire for hidden information (F2) until the first such title pays for the fix. The
two interface changes that would matter most — `createInitialState` context (F4) and event projection
(F2) — are recorded here rather than guessed at now.
