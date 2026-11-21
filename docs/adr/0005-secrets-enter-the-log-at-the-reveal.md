# 0005 — A secret enters the log only when it is revealed

- Status: Accepted
- Date: 2026-11-21
- Issue: [#40](https://github.com/jyyyeung/roundhouse/issues/40)

## Context

State is projected per viewer ([ADR 0001](0001-projections-and-wire-contract.md)) and the event log
is replay input ([ADR 0002](0002-event-log-as-replay-source.md)). Neither says anything about
_who an event is for_: `apps/server/src/ws/hub.ts` sends one `applied` frame per socket carrying the
same, unprojected `events` array. The M0-7 spike recorded this as finding **F2**, and it is the
reason a hidden-information game is not simply "a projection plus a table".

Duel (M5-1) is the first game with a genuine secret: two players pick a card simultaneously and
neither may learn the other's card until the round resolves. Sending a pick as an event payload
would broadcast it to the opponent's socket immediately, no matter what the state projection does.

There were two ways out:

1. **Project event payloads per viewer** (fix F2): keep recording the card in the log, filter it at
   the broadcast boundary per socket.
2. **Project the log's vocabulary**: only put into the log the facts that are true for everyone.

## Decision

The second. An event is a public fact.

- `duel_picked` carries `{ playerId }` and nothing else. It says "this seat has committed", which is
  public tempo, and it is emitted only for the _first_ pick of a round.
- The second pick is not a separate event. It arrives as part of `duel_round`, which carries
  `{ plays: [{ card, playerId }], round, scores, winnerId }` — the reveal, in seat order, to
  everyone at once.
- The pending card lives in authoritative state (`pending: Record<playerId, card>`) and reaches only
  its owner, through `projectDuelView`'s `yourPick` field.
- A completed match replays exactly: `duel_round` rebuilds rounds, scores and pending-clearing;
  `duel_decided` carries the server's tie-break draw so it is never re-rolled; `game_finished` closes
  the match.

The consequence to accept honestly: **folding the log cannot rebuild a round that is still in
progress.** A log that stops between the two picks replays to a state with an empty `pending`, so a
rebuild from events alone would open the round again and let the first player re-pick. That is why
`applyEvent` documents `duel_picked` as a no-op on state and why the `game` row — not the log — is
authoritative for a live round. The log's guarantee is narrowed from "always equal to state" to
"equal to state once every round in it is resolved", which is the guarantee a rebuild actually needs
and is asserted three ways: the reducer's fold test, the conformance suite's 200-game replay
property, and a Postgres integration test that folds the stored log back into the stored state.

## Alternatives considered

- **Per-viewer event payloads (F2).** Rejected for now, not forever: it needs a per-event projection
  seam, a per-viewer variant of every payload schema in `packages/game-core/src/wire.ts`, and N
  projections per broadcast. This ADR buys the same secrecy for the games that can express a secret
  as "not yet said aloud", at zero transport cost. What would force F2: a game that must acknowledge
  a private input _in the log_ — a private draw acknowledged per action, or an auction where each
  bid must be logged without becoming public. Write that ADR when that game exists.
- **Encrypt the pending pick in the log.** Rejected: it makes replay depend on a key, and "the log is
  readable" is a property worth more than the events it would save.
- **Write the pick to a side table until the reveal.** Rejected: a second source of truth for game
  state, when `game.state` already is one and is already written transactionally.
- **Emit both picks and let the client hide the opponent's.** Rejected outright: the secret would be
  in the opponent's browser, which is not a secret.

## Consequences

- Broadcasting stays one frame per seq for every socket, so a secret costs nothing in fan-out. The
  hub (`apps/server/src/ws/hub.ts`) does not change.
- The log is one event smaller per round: two picks become one `duel_picked` plus one `duel_round`.
- A client learns its own pick from the projection (`yourPick`), never from an event — so a client
  that reconnects mid-round still sees what it played, and one that did not play sees nothing.
- `secretVisibility: "owner-only"` in the conformance fixtures now has a real module behind it: the
  suite checks that the marker planted in `pending` reaches the owner's projection and no other
  viewer's, including the "player row with no seat" case.
- The pattern is documented for the next author in
  [`docs/adding-a-game.md`](../adding-a-game.md): _if a fact is a secret, it is state until it is a
  reveal, and only then is it an event._
