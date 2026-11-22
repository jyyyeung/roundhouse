# 0006 — A seat is a position, not a membership

- Status: Accepted
- Date: 2026-11-22
- Issue: [#44](https://github.com/jyyyeung/roundhouse/issues/44)

## Context

`tablePlayer` is keyed by `(tableId, userId)` with a unique `(tableId, seatIndex)`, and
`gameTable.hostUserId` is written once at create. Until M1-2 there was no way to remove a seat at
all, so the two facts that make seats work had never been decided:

1. **What a seat index means.** Every module takes `playerIds: string[]` and reads it positionally
   (`DuelState.playerIds[seat]`, yatzy's `you` index, `currentPlayerIndex`). If seat 1 leaves a
   three-seat table and seat 2 stays at index 2, every module sees a player list with a hole in it —
   and `reduce` would compute against a table that no longer matches the seated players.
2. **What happens to the table itself.** A lobby whose last player leaves is not a tombstone. If the
   row stays, the invite code stays taken and one abandoned lobby per mis-click accumulates.

Host departure had a third unanswered question: `startTable` requires `hostUserId === userId`, so a
departed host leaves a table nobody can start.

## Decision

**Seats are positions `0..n-1`, compacted on every removal.** `removeSeatFromTable` in
`apps/server/src/room/runtime.ts` deletes the row, then renumbers the survivors in two passes
(`seatIndex = -(index + 1)`, then `seatIndex = index`) because the unique index would collide if a
row moved into a seat another row still held. The two passes run inside the same transaction that
holds `lockTableById`.

**Host transfer is automatic and needs no endpoint.** If the host loses their seat, `hostUserId`
becomes the lowest remaining seat. That is the only rule that cannot strand a lobby, and it makes
"the host went away" a non-event rather than a state the platform has to track.

**An empty lobby is deleted.** `leaveTable`/`kickTablePlayer` delete the `gameTable` row when the
last seat goes; the existing cascades clean `tablePlayer`, `game`, `game_event` and `chat_message`.
The invite code becomes reusable, and no reader has to handle a closed lobby.

**Leaving mid-game is refused (`game_in_progress`, 409).** A mid-game exit needs forfeit semantics —
does the abandoned player lose, does the game end, who wins — and inventing them inside a leave
endpoint would change game outcomes without a game saying so. Leave and kick are therefore lobby
operations (a finished table still allows leaving). Forfeit belongs to the milestone that owns
game outcomes.

**Removal is idempotent and pushes.** `leaveTable` on a table that is gone, or for a caller who is
not seated, returns `removed: false` with 200 instead of an error: a double-clicked Leave button, or
a client retrying after a dropped response, is not a failure. Every successful mutation calls
`onTableChanged`, so the room re-reads the seat list; the removed player's sockets get an `error`
frame (`kicked` / `seat_left`) and are closed with 4403, and their next `subscribe` is refused by
the existing seat check (`not_seated`) — no eviction state has to be remembered.

## Consequences

- A module never sees a sparse `playerIds`: `applyGameIntent`, `createInitialState` and `projectStateFor`
  read the same contiguous list the seat cards show.
- Seat numbers are not identities. A player can move from "Seat 3" to "Seat 2" by someone else
  leaving; nothing may persist a seat index as a key for a player. Today nothing does — the views
  publish `you` as an index into the current list, and the client labels seats from
  `meta.seatUserIds` on every snapshot.
- A refused leave is the only place the web shows an error for these routes; the kicked player gets a
  page-level notice instead of a toast, because their socket is gone and no refresh can fix it.
- The `game_in_progress` rule is the seam for a future forfeit: when M3 owns game outcomes, the same
  endpoint can accept a forfeit intent instead of returning 409.
