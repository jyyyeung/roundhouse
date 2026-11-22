# 0009 — A replay is a server-projected view, not event payloads

- Status: Accepted
- Date: 2026-11-22
- Issue: [#57](https://github.com/jyyyeung/roundhouse/issues/57)

## Context

ADR 0002 made the event log a replay source: every module folds `applyEvent` back
to the state `reduce` produced. That gives the server the ability to rebuild a
finished game, and M2-2 asks for something a person can actually watch — a
scrubber over a game that ended last week.

The obvious browser-side implementation is to ship the log and fold it in the
client. `applyEvent` is pure, the code already exists, and the UI could scrub
without another round trip. It is also disqualified three times over:

1. **It breaks invariant I1.** The log holds real payloads. For yatzy that is
   resolved dice — fine. For duel the log deliberately holds only `{playerId}`
   for a pick (ADR 0005), and once a round resolves it holds both revealed cards.
   A client editing that fold decides for itself which cards it is allowed to
   look at mid-round; a client that receives every event payload has already been
   told everything the fold needed. Hidden information cannot survive a rule that
   lives in the client.
2. **It duplicates a seam.** `projectStateFor` is the one choke point where raw
   state becomes a view (ADR 0001, guarded by `scripts/check-projection.mjs`).
   Folding in the browser means a second place that holds raw state and a second
   implementation that has to agree with the first.
3. **It makes every module a browser dependency.** Game code would ship to the
   client to power a page most players never open.

## Decision

**The server folds the log and sends projections plus a sentence.**

`apps/server/src/room/replay.ts` exports
`buildReplay({ module, initialState, events, viewer })`. It folds `applyEvent`
once over the stored log, and emits one `ReplayTurn` per event that the module
describes:

- `view` is `projectStateFor(stateAfterSeq, viewer)` — the same projection seam a
  live snapshot uses, called through `projectReplayedState` so the raw-state cast
  stays inside `apps/server/src/room/projection.ts`. A replay step for a seat and
  a replay step for a spectator differ exactly the way live snapshots do.
- `phrase` is the module's own words. `GameModule.describeEvent?(event)` returns
  a verb phrase (`"rolled 5 2 4 1 2"`, `"scored full house for 25"`) or `null`
  for bookkeeping (`turn_advanced`) and for events a module declines to narrate.
  `null` means "not a step": the scrubber does not stop there. Without the hook a
  step is titled with the humanised event type, which is honest and boring.
- Duel narrates `duel_round`, `duel_decided` and `game_finished` — never
  `duel_picked`. A step between two picks would show a round whose pending card
  the fold cannot rebuild, so a replay shows rounds as they were revealed.
- If the log's final event earned no step, one closing `final position` step is
  appended so the scrubber always ends on the real final board. An empty log
  yields a single `game started` step.

`GET /api/tables/:id/replay` (session required) returns
`{ tableId, gameId, finishedAt, meta, turns }`. A participant gets 200; a
signed-in stranger 403 `not_a_participant`; a missing table 404 `table_missing`;
a live game 409 `table_not_finished`; and a log whose length disagrees with
`game.seq` 409 `replay_unavailable` — an old `chat_sent`-in-`game_event` bug could
leave holes, and inventing steps for a hole is worse than refusing.

Client side, `apps/web/src/routes/replay.tsx` holds no game rules: it moves an
index, renders `renderGameView` with `readOnly: true`, and labels a step by
joining the seat label to the server's phrase. `GameViewProps.readOnly` is the
one hook every game honours — a view must not offer an action it cannot deliver.

**Not in scope, deliberately:** checkpoints. Folding a finished social game is
one pass over tens of events (a 500-event replay is asserted under 200 ms in
`apps/server/src/room/replay.test.ts`); a checkpoint table earns its migration
only if a game ever gets long enough to need one.

## Consequences

- Hidden information is preserved by construction: what the wire carries is what
  a projection may carry, so a duel replay leaks nothing a live spectator could
  not see. `packages/game-core/src/replay.ts` types the response and a test
  asserts the serialised body holds no `payload` key and no unrevealed card.
- The replay is viewer-specific, so it is served per participant rather than
  cached or shared: the same finished game reads differently to each seat. A
  public/shareable replay would need a spectator projection to be the only
  projection served — that is M2-1's job, not this one's.
- Adding a game does not add replay work: implement `applyEvent` (already
  required) and optionally `describeEvent`. Forgetting the hook degrades titles
  to event types instead of breaking the page.
- A step costs one projection of the whole state. That is the same cost the live
  wire already pays per broadcast, so no new performance class enters the system.

## Alternatives considered

- **Ship the log, fold in the browser.** Rejected above: it puts raw state and a
  second fold in the client, defeating I1 and the projection guard.
- **Store a projected view per step at write time.** Turns reads into a column
  scan, but writes a redundant copy of every board into the database, and the
  projection is viewer-relative — one stored view cannot serve two seats.
- **Replay only what the log already exposes publicly (event type + actor).**
  Cheaper, but then the page has to render a board from a log it cannot fold,
  which is the browser-fold decision wearing a smaller coat.
