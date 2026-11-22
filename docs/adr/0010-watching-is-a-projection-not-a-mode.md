# 0010 — Watching is a projection, not a mode

- Status: Accepted
- Date: 2026-11-22
- Issue: [#56](https://github.com/jyyyeung/roundhouse/issues/56)

## Context

M2-1 asks for spectators: someone who is not sitting at a table but can still
watch it. Two things made this more than a UI feature.

**The seat list was the admission check.** `subscribe` refused anyone whose id
was not in `gameTable.seatUserIds` with `not_seated`. That check was load-bearing
twice: it decided who receives a table's frames, and it decided what those frames
contain — `projectStateFor` had no per-viewer input other than "which seat am I",
rendered as `you: <index>`. A spectator has no index.

**Chat history was the other half of the question.** Finding F7 from the
conformance spike said the stored chat snapshot carried the sender's projection,
which for a hidden-information game writes that player's hand into shared
history. By the time M2-1 started, the seam had already reduced the chat row to
`getTableSnapshot({ asUserId: null })` — a viewer with no seat. So the remaining
work was to pin that down with a test and to decide the actual open question:
whether a watcher may type. It may, on a table the host opened, because chat is
the room's conversation and a watcher is in the room.

The obvious implementation is a spectator _mode_: a second snapshot shape, a
`spectating` boolean in meta, a parallel `subscribe` path that skips the seat
check. Every one of those is another place where the answer to "what may this
connection see" is decided.

## Decision

**Watching is the projection a viewer with no seat already gets.**

1. `ViewerView` gains a spectator variant: `{ kind: "spectator", userId }`. The
   game's `projectStateFor` returns the board it would show a player who is
   watching — for yatzy, exactly the public allowlist with `you: null`; for
   duel, the same minus every unrevealed pick.
2. Admission becomes a single boolean on the table, `game_table.spectators`
   (wire: `meta.spectatorsAllowed`), chosen by the host at creation. A seat is
   still the only way in unless that flag is set. The frame shape, the room
   membership and the chat path are the same for a watcher as for a player.
3. Presence splits by membership, not by permission: `onlineUserIds` lists
   seats, `spectatorUserIds` lists connected non-seats, and a user who holds a
   seat never appears in the second list.
4. Any intent from a non-seat is refused as `not_a_player` by the runtime, which
   already had that check — a watcher cannot act because there is no seat to act
   from, not because a UI hid a button.
5. The chat snapshot is projected with `asUserId: null` on every message, so a
   shared log row can never encode its author's seat or hand. Membership decides
   who may chat: a seat, or a watcher on an open table.

## Consequences

- One choke point still answers "what may this viewer see" (ADR 0001), guarded by
  `scripts/check-projection.mjs`. Watching adds a viewer, not a path.
- A game that cannot express a spectator projection cannot be watched. That is
  the point: it fails the conformance suite instead of leaking.
- Watchers are unbounded. There is no cap and no "kicked from watching" — a
  socket that leaves simply drops out of `spectatorUserIds`. If watching ever
  costs real money, the cap belongs next to `softSeatCap`.
- The host's choice is per table and immutable today; a `spectators` toggle
  after creation would need its own presence broadcast and is not built.
- A watcher who joins the game takes a seat and stops being a spectator in the
  same presence frame — there is no separate "promote" step, because a seat is
  the only thing either role reads.
