# ADR 0003 — Seq-versioned incremental sync

- **Status:** Accepted
- **Date:** 2026-11-21
- **Invariants:** I4
- **Roadmap:** M0-4

## Context

There is no incremental sync today; there is a full reload per event.

`apps/web/src/routes/table.tsx:243` receives `{ type: "event" }`, ignores its contents, and
re-sends `{ type: "subscribe" }`. The hub then runs `subscribe()`, which:

1. re-reads the snapshot from Postgres (`hub.ts` → `runtime.getTableSnapshot`),
2. re-sends **up to 200 chat rows** (`apps/server/src/ws/hub.ts:180` → `persistence.listChatMessagesForTable(…, limit = 200)`),
3. re-broadcasts `presence` to every socket at the table.

A single dice roll therefore costs each client the whole chat history. A 50-roll four-player game is
roughly 50 × 4 × 200 unnecessary frames, and presence noise scales the same way. The client also
carries an ad-hoc `snapshotWatchTimer` (`table.tsx`, 4s) to paper over subscribe frames that are
dropped, which is a symptom of "resubscribe" being the only sync primitive.

Meanwhile the server already has what incremental sync needs: `game.seq` is monotonic per game, and
`game_event` has a unique `(game_row_id, seq)` index. Once ADR 0002 lands, `seq` counts game
transitions only.

## Decision

**A client's view is a function of `seq`.** The protocol grows a version and three rules.

```ts
type ClientMessage =
  | { v: 2; type: "subscribe"; tableId: string; sinceSeq?: number }
  | { v: 2; type: "sync"; tableId: string; sinceSeq: number }
  | { v: 2; type: "chatPage"; tableId: string; beforeId?: string }
  | { v: 2; type: "intent"; tableId: string; actionId: string; intentType: string; payload: Json }
  | { v: 2; type: "chat"; tableId: string; actionId: string; text: string };

type ServerMessage =
  | { v: 2; type: "snapshot"; tableId: string; seq: number; state: Json; meta: TableMeta }
  // authoritative state for the frame that just happened — the client never infers state
  | { v: 2; type: "applied"; tableId: string; seq: number; state: Json; meta: TableMeta; events: EventEnvelope[] }
  | { v: 2; type: "events"; tableId: string; fromSeq: number; toSeq: number; state: Json; meta: TableMeta; events: EventEnvelope[] }
  | { v: 2; type: "chat"; tableId: string; message: ChatWire }
  | { v: 2; type: "spoke"; tableId: string; message: ChatWire }        // ack for the sender only
  | { v: 2; type: "presence"; tableId: string; onlineUserIds: string[] }
  | { v: 2; type: "error"; tableId?: string; actionId?: string; code: string; message: string };
```

1. **Every applied intent broadcasts `applied` with the resulting state.** Not just on
   `game.finished` (`apps/server/src/ws/handlers.ts:78` is the only place a snapshot is pushed today).
   Events stay in the frame for animation/audio, not as a state source.
2. **Gaps are repaired, not reloaded.** Client tracks `lastSeq`; on `applied.seq > lastSeq + 1` it
   sends `sync { sinceSeq: lastSeq }`. Server answers with `events` (bounded replay from the log,
   ≤ `SYNC_REPLAY_LIMIT`, e.g. 200 events) or falls back to `snapshot` when the gap is larger or the
   game row is gone. Bounded either way: O(new events), never O(game length).
3. **Chat and presence stop riding on subscribe.** Chat history is paged (`chatPage { beforeId }`,
   N=50, oldest-first in the response) and only fetched past the first screen. Presence is published
   when the *set* of connected users changes, not on every subscribe — compare the computed set
   against the last published one and drop no-ops.

Client-side, the `event → subscribe` path is deleted; `snapshotWatchTimer` survives only as the
initial-connect guard; reconnect backoff is kept as-is.

## Consequences

**Positive**

- Traffic per action becomes O(1) frames and O(state size) bytes, independent of chat history and
  game length.
- `seq` becomes the single observable progress signal: animations, optimistic reconciliation, and
  "am I current?" all read one number. Spectator and replay (M2) reuse `events` frames verbatim.
- Fixes a real user-visible bug class: today, a dropped `subscribe` frame silently strands a client
  on stale state until the 4s timer fires; with `applied` frames there is nothing to strand.

**Negative / costs**

- The server must project state before broadcasting (ADR 0001) rather than letting the client drift
  on events, which costs one projection per intent per subscriber — the right trade.
- Two sync paths exist for a while (`events` replay only works once ADR 0002 is in, so M0-4 lands
  after it and `snapshot`-fallback covers the interim). Keeping the fallback permanently is
  deliberate: replay is an optimisation, not a correctness requirement.
- `v: 1` frames are not accepted. Single deployment, no published client — hard cutover.

## Alternatives considered

- **Send state on every `event` frame and drop `applied`.** Tempting (one message fewer) but conflates
  "what happened" with "what is true", so a client that misses a frame has no way to say what it
  missed. Rejected: keeps replay impossible to bolt on.
- **Client refetches `GET /api/tables/:id` on every event.** Works, is worse: extra HTTP round trip,
  no ordering guarantee against WS delivery, and no reason for the socket to exist.
- **Server-push-only with no client `sinceSeq`.** Simpler, but reconnect after a network blip then
  requires a full snapshot; `sinceSeq` makes the common case cheap and is four lines of code.
- **WebSocket message-level acks / at-least-once delivery.** Overkill: `seq` plus idempotent
  snapshot replacement already gives at-least-once semantics to the state, which is all the client
  needs.
