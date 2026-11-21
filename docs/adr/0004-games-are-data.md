# 0004 — Games are data, not branches

- Status: Accepted
- Date: 2026-11-21
- Issue: [#39](https://github.com/jyyyeung/roundhouse/issues/39)

## Context

`GameModule` (ADR 0001) already made a game's _rules_ pluggable: `createInitialState`, `reduce`,
`projectStateFor`. What stayed hardcoded was everything around the rules — the parts a player
touches before and instead of playing:

- `apps/server/src/http/tables.ts` validated create-table bodies with
  `if (body.gameId === "yatzy")`, so a second game needed an edit to a platform route.
- `apps/server/src/modules/registry.ts` could answer "what is game X" but not "what games exist",
  so a lobby could not offer a choice.
- Seat limits were table-level (`softSeatCap`, default 4), so nothing stopped a table of one player
  for a game that needs two, and nothing stopped seven for a game whose score sheet ends at six.
- `apps/web/src/games/registry.tsx` branched on `meta.gameId` and its `GameViewProps` carried
  `rollVersion` — a _dice_ concern — plus the table route itself read `message.state.dice`. The
  browser could not render a game that has no dice without editing shared code.

Every one of those is the same mistake at a different layer: the platform knowing facts that belong
to a game. It is cheap while there is one game and expensive at two, because each new title copies
the shape of the first one's leaks into shared files.

## Decision

A game declares everything the platform needs, and the platform branches on nothing.

`GameModule` gains three fields, next to `displayName`:

```ts
playerCount: {
  min: number;
  max: number;
} // seats the rules support
defaultConfig: Json; // what a fresh table plays
configSchema: z.ZodType; // what a valid config looks like
```

They are enforced at the two places a table can be wrong: `createTable` validates `configSchema`
(and rejects `softSeatCap` outside `playerCount`), `startTable` checks the seat count against
`playerCount`. The table row keeps `softSeatCap` as an override _within_ that range.

Three consequences follow:

1. **A catalogue is derived, not written.** `GET /api/games` returns `{ id, displayName,
   playerCount, defaultConfig }` per registered module (`gameCatalogueSchema` in
   `packages/game-core/src/wire.ts`). `configSchema` is deliberately absent: it is a `z.ZodType`,
   not JSON, and the client does not validate configs — the server does.
2. **The lobby is a client of that catalogue.** It lists whatever the server reports, asks the
   game's own `ConfigControls` component to render the per-game form fields, and resets the config
   to the new game's `defaultConfig` when the picker changes ("a yatzy ruleset means nothing to a
   duel").
3. **Game code lives in game folders.** `apps/web/src/games/<id>/` owns the view, its controls and
   its table title; `apps/server/src/modules/registry.ts` and
   `apps/web/src/games/registry.tsx` are the only two files that name a game.

`scripts/check-projection.mjs` grew a sixth rule, `no-game-branch`, so this stays true: platform
code under `apps/server/src` and `apps/web/src` may not contain a string literal equal to any id in
`packages/games/*` unless it lives under a `games/` or `modules/` folder. The guard reads the game
list from disk, so a second title is covered the moment its package exists.

## Alternatives considered

- **A game id union in `game-core`** (`type GameId = "yatzy" | "duel"`). Rejected: it makes every
  new game a change to a shared package and invites exhaustive switches in platform code — exactly
  the branching this ADR removes.
- **Config as a free-form `Json` with the game validating at `reduce` time.** Rejected: a table
  created with an unusable config fails when someone tries to play, not when they create it, and a
  lobby cannot prefill a sensible default.
- **Server-rendered config forms** (schema introspection). Rejected as premature: two games do not
  justify a form generator, and the `ConfigControls` component is 40 lines.

## Consequences

- Adding a game is: a package under `packages/games/<id>/`, one line in
  `apps/server/src/modules/registry.ts`, one entry in `apps/web/src/games/registry.tsx`. No route,
  no lobby, no runtime edit. See [`docs/adding-a-game.md`](../adding-a-game.md).
- `playerCount` is now the single source of seat truth; `softSeatCap` narrows it per table. A test
  asserts the default cap equals `module.playerCount.max`.
- The conformance suite (`describeModuleConformance`) checks that `defaultConfig` satisfies
  `configSchema` and that `playerCount` is a sane range, and the yatzy fixtures' `playerCounts`
  must equal the module's declaration — so a declared range that the fixtures do not play with
  fails loudly.
- Hidden information is still only half-proven: projections are per viewer (ADR 0001) but event
  payloads are still broadcast unfiltered (finding F2). That is issue
  [#40](https://github.com/jyyyeung/roundhouse/issues/40)'s job, not this one's.
