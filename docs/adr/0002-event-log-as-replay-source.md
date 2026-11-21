# ADR 0002 — The game event log is the replay source

- **Status:** Accepted
- **Date:** 2026-11-21
- **Invariants:** I2, I3
- **Roadmap:** M0-3, M0-5, M0-9

## Context

The v1 spec claims the append-only event log "enables live spectator, turn replay, and chat
snapshots", and `game_event` is indeed written on every applied intent. It is not usable for any of
that today.

- **Events do not record outcomes.** `dice_rolled` is emitted with `payload: {}`
  (`packages/games/yatzy/src/reduce.ts:156`). The resolved dice exist only in the post-reduce state
  row. There is no way to reconstruct the state at an arbitrary `seq` — so there is no replay, and
  no way to audit whether a stored state is consistent with its history.
- **The log is not game-only.** Chat writes a `chat_sent` row into `game_event` and increments
  `game.seq` (`apps/server/src/ws/persistence.ts:76-89`, `apps/server/src/db/schema.ts` unique index
  `game_event_game_row_id_seq_idx`). Chat is not a game transition, so it pollutes both the
  replay stream and the sequence the client uses for sync (ADR 0003).
- **Application is not serialised.** `applyGameIntent` (`apps/server/src/room/runtime.ts`) reads the
  table and current game **without** a row lock — `lockTableById` is used by `joinTable`,
  `startTable`, and `rematchTable` (lines 248, 295) but not here. Two concurrent intents on one
  table both read `seq = n`, both emit events numbered `n+1`, and one transaction dies on the unique
  index (surfacing as `internal_error`) or silently overwrites the other's state. A double-tap on a
  flaky phone is enough to hit this.

## Decision

**Events are the replay input, and `applyEvent` is how they are consumed.**

```ts
export type GameEventPayload = { type: string; payload: Json };

interface GameModule {
  reduce(state: Json, intent: ClientIntent, ctx: ReduceContext): ReduceResult; // produces events
  applyEvent(state: Json, event: GameEventPayload): Json; // folds one event
}
```

with the invariant, enforced by property test in `packages/game-testkit` (M0-7):

> For every reachable state `S` and intent `I`:
> `reduce(S, I).events.reduce(applyEvent, S)` deep-equals `reduce(S, I).state`.

Consequences of taking this seriously:

1. **Events carry their outcome.** `dice_rolled` becomes `{ dice, rollsLeft }`; `category_scored`
   becomes `{ category, score, nextPlayerId }`. Any state transition not derivable from the event is
   a bug, and the property test above says so immediately.
2. **`reduce` becomes pure in its randomness.** `ctx.randomInt` may only be called during `reduce`;
   modules must never call `Math.random`/`Date.now` directly (I2). Because the outcome is recorded
   in the event, replay needs no RNG at all.
3. **`game_event` is game-only.** Delete the `chat_sent` write in
   `apps/server/src/ws/persistence.ts`; chat already lives in `chat_message` and is already
   retrieved from there. `game.seq` then advances only on game transitions, which is the property
   ADR 0003's sync model depends on.
4. **Intent application is serialised.** `applyGameIntent` takes `lockTableById(tx, tableId)` before
   reading, so `seq` allocation is single-writer per table. That is also what makes
   `game_event_game_row_id_seq_idx` a guarantee rather than a source of 500s.

Checkpointing: replay from `seq = 0` is fine for a Yatzy game (tens of events). If a future module
has long games, store a checkpoint snapshot every N events — the log stays authoritative, the
checkpoint is a cache. Not built now; noted so it is not discovered late.

## Consequences

**Positive**

- Replay, spectator, audit, and scoreboarding (M2, M4) all read the same log through the same
  `applyEvent` they already have to implement for the fold test.
- A corrupted or diverged state row becomes detectable: fold and compare (a `/admin/verify` style
  check, or a nightly job).
- Determinism makes game module bugs reproducible from production data without screenshots.

**Negative / costs**

- Every module implements two functions instead of one, and they can drift. That drift is precisely
  what the property test is for; without the test, `applyEvent` would be a second, quieter source of
  truth. Do not ship `applyEvent` without M0-7.
- Event payloads grow (dice arrays, scores) — a few dozen bytes per event, irrelevant at this scale.
- Existing rows are not replayable. Migration is a no-op for correctness (old games just cannot be
  replayed); if that matters, backfill `dice_rolled` from state at write time is impossible after the
  fact, so accept it and move on.

## Implementation notes (M0-3, #13)

- `applyEvent` lives in `packages/games/yatzy/src/apply-event.ts` and is exposed on `GameModule`.
  It folds `dice_rolled {dice, rollsLeft}`, `dice_held {holds}`, `category_scored
  {category, score, nextPlayerId}`, `turn_advanced {currentPlayerId}`, `game_finished {winnerIds}`,
  reusing the reducer's own `applyBonus`/`resetTurn` so the two paths cannot disagree about scoring
  or whose turn it is.
- An event type the module does not recognise leaves state untouched instead of throwing. That is
  what makes a pre-migration log harmless: rows written before this change can still be replayed
  (they simply contribute nothing), and replay can never fail on data it did not write.
- `chat_sent` is gone from the write path. `apps/server/src/ws/persistence.ts` no longer imports
  `game` or `game_event`, and its `DbLike` is `Pick<Database, "select" | "insert">` — the chat path
  cannot bump `seq` even by accident.
- **Migration note.** No backfill, by design. `game_event` rows written before commit `M0-3` carry
  `dice_rolled` with an empty payload, so those games cannot be replayed to the exact dice — the
  draws were never recorded and cannot be recovered from state after the fact. Replay correctness
  holds for every game created after this change. Old `chat_sent` rows stay in the log with a `seq`
  of their own; replay ignores them (see above), so a legacy game's `seq` numbering still folds
  consistently, it just cannot reproduce dice.

## Amendment (M0-7, #17): replay is bounded by the module, not by the wire

The spike that produced ADR 0001's amendment also produced the sharpest constraint on this one. It is
worth stating before the alternatives, because it narrows what "the log is the replay source" can
mean once a game has hidden information.

**Replay needs complete event payloads; the wire cannot carry them (F2).** `applyEvent` has to
reproduce private state, so a `card_drawn` event must name the card even when only its owner may see
it. The hub currently forwards that event list unchanged to every socket —
`apps/server/src/ws/hub.ts:389` (`events: input.events`) inside `publishApplied`'s per-socket loop and
`apps/server/src/ws/hub.ts:283` (`events: result.events`) in `sendSyncFrame` — while the `state` beside
it _is_ projected per viewer. For a hidden-information game that is a leak one frame after every
private draw. Nothing in this ADR needs to change for the log: the log stays complete and server-side.
What has to change is the wire, and the decision belongs to M5-1, the first title that needs it:

1. `projectEventFor(viewer, event)` on `GameModule`, under the same allowlist discipline as
   `projectStateFor` and with a matching rule in `scripts/check-projection.mjs`;
2. or keep payloads off the wire entirely and send `type`, `actorId` and a public projection,
   letting clients render from projected state (they already do) and treating the event stream as
   notification rather than data;
3. either way the change is local to `publishApplied` and `sendSyncFrame`, and needs no `v` bump
   because `v: 2` clients do not fold events into state.

**A module cannot deal its opening hand (F4).** `createInitialState(config: Json, playerIds: string[])`
receives no `ReduceContext`, so it has no `randomInt`: the spike's deck had to be the deterministic
sequence `[40..1]`. A real shuffled deal has only two homes today, and both are wrong — the deal goes
in `config` (hidden information in a table row, and each creation of the same table deals differently),
or the first intent shuffles (one intent is special, and its event carries the whole hidden deal
through the frame path described above). Both options belong with the same M5-1 decision: pass `ctx`
to `createInitialState`, or make `setup` an intent whose events are private by construction.

Neither finding changes the contract for games with no hidden information, which is why yatzy needed
no code change to pass the suite. Both are written down here so that the first hidden-information title
starts from a decision instead of a leak.

## Alternatives considered

- **Store `stateAfter` on every event.** Simplest replay (read the last one), but duplicates state in
  every row, gives no per-player projection for spectator, and makes `seq`-based sync and replay two
  different mechanisms. Rejected: it is a snapshot log wearing an event log's clothes.
- **Re-run `reduce` from recorded intents instead of folding events.** Requires storing every intent
  and every resolved RNG draw, and re-runs all validation during replay — replay can then _fail_,
  which is the wrong property for a read-side feature. Folding events cannot fail.
- **Keep chat in `game_event`, filter on read.** Rejected: seq pollution is the whole problem;
  filtering consumers preserves the bug.
