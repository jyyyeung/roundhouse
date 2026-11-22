# Adding a game

A game is a package that declares its rules, its seats and its config, plus two registry entries.
Nothing in `apps/server/src/http`, `apps/server/src/room` or `apps/web/src/routes` changes — a guard
(`no-game-branch`, in `scripts/check-projection.mjs`) fails the build if platform code starts naming
a game again.

The short version: copy `packages/games/yatzy`, rename it, replace the rules, add two lines.

## 1. The module

Create `packages/games/<id>/src/module.ts` exporting a `GameModule`
(`packages/game-core/src/module.ts`):

```ts
export type GameModule = {
  id: string; // stable, lowercase, matches the package folder
  displayName: string; // what the lobby shows
  playerCount: { min: number; max: number };
  defaultConfig: Json; // what a fresh table plays
  configSchema: z.ZodType; // what a valid config looks like
  intents: Readonly<Record<string, z.ZodType>>; // inbound action allowlist
  createInitialState(config: Json, playerIds: string[]): GameState; // the runtime adds tableId to config
  reduce(state: GameState, intent: ClientIntent, ctx: ReduceContext): ReduceResult;
  projectStateFor(state: GameState, viewer: ViewerView): Json; // what that viewer may see
  applyEvent(state: Json, event: EventEnvelope): Json; // replay: fold one event
  isFinished(state: Json): boolean;
};
```

Three of those carry the load that the platform used to hardcode:

- **`playerCount`** is the only source of seat truth. `createTable` rejects a `softSeatCap` outside
  it; `startTable` refuses to start below `min` (`not_enough_players`) or above `max`
  (`too_many_players`); a table with no explicit cap gets `max`.
- **`defaultConfig` + `configSchema`** are validated at create time, so a bad config fails where it
  was typed. `defaultConfig` must satisfy `configSchema` — the conformance suite checks this.
- **`intents`** maps intent type → payload schema. `parseIntent` runs before `reduce`, so `reduce`
  only ever sees payloads that already match. Keep these structural (shape, ranges, enums); game
  _rules_ stay in `reduce`, which returns `{ ok: false, error }` for illegal moves.

`reduce` must be pure: same state + same intent + same `ctx` ⇒ same result. Randomness comes from
`ctx.randomInt`, time from `ctx.now`, identities from `ctx.playerIds` — never `Math.random()` or
`Date.now()`.

`projectStateFor` is the only thing a client ever sees. Publish an allowlist of fields, not a spread
of the state, and give every viewer their own copy: seat 0 and seat 1 should differ only in
`you` (`ViewerView` carries the seat index and whether the viewer is a spectator).

## 2. Events as replay input

Every `reduce` result carries `events`. They must be sufficient to rebuild state without re-running
the player's intentions: the property test in ADR
[0002](adr/0002-event-log-as-replay-source.md) folds `events` over the pre-intent state and expects
the post-intent state. So an event that resolves randomness records the outcome
(`dice_rolled { dice, rollsLeft }`), not the fact that a roll happened.

Deal shuffled openings inside `createInitialState` (`config` carries `tableId` by the time the
runtime calls it) — never in `reduce`.

## 2b. Secrets: state until revealed

An event is a **public** fact: the hub sends the same `events` array to every socket, so anything you
put in a payload is on every opponent's wire before the state projection runs. A secret therefore
lives in state (`pending`, a hand, a hidden card) and reaches only its owner through
`projectStateFor`; it becomes an event at the moment it becomes public — the reveal. Duel is the
worked example: `duel_picked` says only `{ playerId }` ("this seat has committed"), and both cards
appear once, in `duel_round`, after the round resolves. Read
[ADR 0005](adr/0005-secrets-enter-the-log-at-the-reveal.md) before designing a hidden-information
game; the price is that a log which stops mid-round cannot rebuild that round's pending secret.

## 3. Registration

Two files, one line each:

```ts
// apps/server/src/modules/registry.ts
const modules: Record<string, GameModule> = {
  [yatzyModule.id]: yatzyModule,
  [duelModule.id]: duelModule, // ← here
};
```

```tsx
// apps/web/src/games/registry.tsx
const gameUi: Record<string, GameUi> = {
  yatzy: {
    ConfigControls: YatzyConfigControls,
    View: YatzyViewForTable,
    tableTitle: yatzyTableTitle,
  },
  duel: { View: DuelViewForTable }, // ← here (no config form, nothing to name)
};
```

`GET /api/games` and the lobby's game picker are derived from these, so they need no edit. The
picker only appears once more than one game exists.

## 4. The client view

Put the browser half in `apps/web/src/games/<id>/`:

- **`View`** receives `GameViewProps` (`apps/web/src/games/registry.tsx`): `meta`, `state`
  (`unknown` — the platform does not parse game state), `currentUserId`, `onlineUserIds`,
  `messages`, `onIntent`, `onSendChat`, `hasMoreChat`, `loadingOlderChat`, `onLoadOlderChat`. Write
  one adapter that narrows `state` to your view type; that cast is the game's declaration that its
  projection has that shape.
- **`ConfigControls`** (optional) renders the per-game half of the create-table form. It gets
  `{ config, onChange }` and nothing else; keep the `<select>`/`<input>` ids prefixed with the game
  id so two games cannot collide.
- **`tableTitle`** (optional) names a table in the lobby list, e.g. "Yahtzee" rather than "Yatzy".

Anything a client needs must already be in the projection: the view may not fetch game state, and
the platform will not hand it the raw row.

Two pieces of feel come free if the projection says the right things:

- **The turn banner.** Publish `currentPlayerId` (a seat id, or `null`) when play is sequential and
  the table header tells the current player "Your turn" and everyone else who they wait for.
  A simultaneous game (Duel) publishes nothing and gets no banner — no per-game branch anywhere.
- **Sound and haptics.** Call `feedback.play("roll" | "hold" | "score" | "win")`
  (`apps/web/src/lib/feedback.ts`) from your view when the projected state you already render
  changes. It is muted by default, respects `prefers-reduced-motion`, and no-ops where the platform
  has no audio — the server never learns that a phone buzzed, and no event is invented for it.

Never derive a player's name yourself: `seatLabels(seatUserIds, currentUserId)` in
`apps/web/src/lib/seats.ts` is the one implementation, and `avatarFor(userId)` gives a stable
generated avatar for the same id.

## 5. Prove it

Add `packages/games/<id>/src/conformance.test.ts`:

```ts
import { describeModuleConformance } from "@roundhouse/game-testkit";

describeModuleConformance(duelModule, duelFixtures);
```

The suite checks purity, idempotence of illegal intents, the event-fold property, projection
hiding (state fields a viewer must not see), seat symmetry and your declared
`playerCount`/`defaultConfig`. Fixtures must agree with the module: `fixtures.playerCounts` must
equal `module.playerCount`, so the suite fails when they disagree rather than silently playing a
different game.

Declare the secret in the fixtures instead of hiding it by hand: `secretVisibility: "owner-only"`
plus a `plantSecret` that writes a marker where the real secret lives makes the suite fail if any
other viewer's projection carries it. Event payloads are broadcast to every seat (finding F2), so the
secret must not be in one until it is revealed — see [ADR 0005](adr/0005-secrets-enter-the-log-at-the-reveal.md).

Then run the gate:

```sh
pnpm typecheck && pnpm test && pnpm check:projection && pnpm lint
```

## Checklist

- [ ] `packages/games/<id>/` with `module.ts`, `reduce.ts`, `view.ts`, `config.ts`, `intents.ts`
- [ ] `playerCount`, `defaultConfig`, `configSchema` declared and enforced by tests
- [ ] `reduce` pure; randomness and time from `ReduceContext`
- [ ] every `reduce` outcome reconstructible from `events` (fold property)
- [ ] secrets are state, not event payloads, until the reveal (ADR 0005)
- [ ] reads `playerIds` positionally and treats it as contiguous `0..n-1` — leaving compacts seats ([ADR 0006](adr/0006-seats-are-positions.md))
- [ ] `projectStateFor` publishes an allowlist; spectators get a valid view with `you: null`
- [ ] `describeModuleConformance(module, fixtures)` passes
- [ ] one line in `apps/server/src/modules/registry.ts`
- [ ] one entry in `apps/web/src/games/registry.tsx` (plus the game's own `View`)
- [ ] turn state published as `currentPlayerId` if the game is sequential; feedback fired from the view
- [ ] `pnpm check:projection` clean — no game id outside `games/`, `modules/` or `packages/games/`
