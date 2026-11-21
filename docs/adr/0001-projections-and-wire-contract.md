# ADR 0001 — Per-viewer projections and a single wire contract

- **Status:** Accepted
- **Date:** 2026-11-21
- **Invariants:** I1, I6
- **Roadmap:** M0-1, M0-2

## Context

`GameModule` declares `getPublicSnapshot(state)` (`packages/game-core/src/module.ts:30`) and the
name suggests a boundary, but no production code calls it — only
`packages/games/yatzy/src/reduce.test.ts:307` does. The server ships the module's raw internal
state: `apps/server/src/room/runtime.ts:354` returns `currentGame.state` verbatim, the hub puts it
in a `snapshot` frame, and the client reads the internal shape directly
(`apps/web/src/routes/table.tsx:202-203` destructures `state.dice`).

Two problems follow.

1. **The signature is wrong for the product.** `getPublicSnapshot(state)` has no viewer, so it
   cannot express hidden information. Liar's Dice, Coup, secret bidding, or any card game cannot be
   implemented without changing the interface — and a projection that ignores the viewer makes
   spectator mode a second, parallel mechanism instead of the same one.
2. **Types are declared twice.** `ClientMessage`/`ServerMessage` are hand-written TS unions
   (`packages/game-core/src/protocol.ts`), parsed by `JSON.parse(...) as ClientMessage`
   (`apps/server/src/ws/hub.ts:308`) and delivered to `onMessage(connection, message: any)`
   (`apps/server/src/ws/handlers.ts:41`). A hand-written union plus an unchecked cast is a
   declaration, not an enforcement.

## Decision

**Projections are per-viewer, and they are the only thing that crosses the wire.**

```ts
export type ViewerView =
  | { kind: "player"; userId: string; seatIndex: number }
  | { kind: "spectator"; userId: string };

export interface GameModule {
  id: string;
  displayName: string;
  intents: readonly string[];              // allowlist enforced at the wire boundary
  seatLimits: { min: number; max: number };
  createInitialState(config: Json, playerIds: string[]): Json;
  reduce(state: Json, intent: ClientIntent, ctx: ReduceContext): ReduceResult;
  applyEvent(state: Json, event: GameEventPayload): Json;          // ADR 0002
  projectStateFor(state: Json, viewer: ViewerView): Json;          // replaces getPublicSnapshot
  isFinished(state: Json): boolean;
}
```

**One choke point on the server.** Every outbound state payload is produced by
`projectSnapshot(module, state, viewer)` in `apps/server/src/room/` — snapshot frames, `applied`
frames (ADR 0003), and replay frames all call it. Nothing else serialises module state. This is
greppable and reviewable: no `state` field may be built outside that function.

**Schemas are the single source of wire types.** `packages/game-core/src/wire.ts` defines Zod
schemas for every client and server message; `ClientMessage`/`ServerMessage` become `z.infer`
aliases. The client parses the same schemas it consumes, so a server-side rename breaks the build
in the client instead of at runtime in a browser tab.

**Intent allowlist.** `handlers.onMessage` rejects an `intentType` not in the active module's
`intents` before `reduce` is called, so an unknown intent is a protocol error rather than
`fail("unknown_intent")` from inside a game module.

### What M0-2 shipped (implementation notes)

- `ViewerView`, `projectStateFor`, and the branded `RawGameState` are in
  `packages/game-core/src/module.ts`. The brand is the point: unprojected state is not assignable to
  `Json`, so it cannot be dropped into a `state` field by mistake.
- `apps/server/src/room/projection.ts` holds `viewerForUser`, `projectSnapshot`, and the single
  `rawGameState` cast from the `jsonb` column.
- `getTableSnapshot` takes `{ tableId, asUserId }` and returns state already projected for that
  viewer; the hub's `publishSnapshot` projects once per connected socket. Chat snapshots are stored
  projected for no viewer, so every reader sees the same board rather than the author's view.
- `intents`, `seatLimits`, and `applyEvent` land with M0-1 and M0-3; the yatzy module keeps its
  current `reduce` signature until M0-3 changes the event payloads.

### What M0-1 shipped (implementation notes)

- `packages/game-core/src/wire.ts` is now the source of the wire types: `clientMessageSchema` and
  `serverMessageSchema` are the schemas, and `protocol.ts` re-exports `z.infer` results so no
  hand-written union sits beside them. `parseClientMessage(raw: string)` returns a result union and
  never throws.
- `intents: Readonly<Record<string, z.ZodType>>` on `GameModule` replaced the issue's proposed
  `readonly string[]` allowlist. One declaration now carries both "which intents exist" and "what
  shape each payload has", and `parseIntent` (`packages/game-core/src/intents.ts`) is the only
  place an inbound payload is validated against a module's own schema. Modules keep the right to
  reject again inside `reduce` with a game-specific error.
- The boundary refuses rather than drops: a malformed frame gets an `error` reply naming the field
  (`bad_message` / `unknown_message_type`), an oversized frame (> 64 KiB) gets
  `frame_too_large` and a 1009 close, and an unauthenticated upgrade now sends
  `not_authenticated` before closing 4401, because a browser WebSocket cannot read a close reason.
- `apps/server/src/ws/handlers.ts` takes `ClientTableMessage` instead of `any`, and the trailing
  branch is a `never` assignment, so a new client frame type cannot be silently ignored.

## Consequences

**Positive**

- Hidden-information games become expressible without touching rooms, transport, or persistence.
- Spectator mode (M2-1) is the same function with a different `viewer`, not a second code path.
- The client's coupling to module internals ends with `projectStateFor` — its shape becomes the
  contract, and `packages/game-testkit` can test it (M0-7).
- Zod at the boundary removes the only `any` that reaches business logic and makes the schema fuzz
  target in M0-6 meaningful.

**Negative / costs**

- Every module must now think about visibility explicitly. For fully-public games (Yatzy) the
  projection is nearly identity, which is a trivial implementation but an extra hop per broadcast.
- Projection runs per send rather than per state change. Cheapest correct version is per-request;
  if it ever shows in profiles, memoise on `(state, seq, viewer.kind)` — do not pre-project into
  storage.
- Hard cutover of `v: 1` → absent users. There is exactly one deployment and no published client,
  so no dual-version support is worth writing.

## Implementation notes (M0-2, #12)

Where the pieces landed:

- `apps/server/src/room/projection.ts` is the seam: `viewerForUser(seatUserIds, userId)` names the
  viewer, `projectSnapshot(module, state, viewer)` is the only function that turns stored state into
  a payload, and `rawGameState(column)` is the only cast out of the `jsonb` column.
- `packages/games/yatzy/src/view.ts` holds `YatzyView` and `projectYatzyView`, written as an
  explicit allowlist (no spread), so a new field on `YatzyState` is invisible until someone adds it
  to the projection on purpose.
- `apps/web` names `YatzyView` and nothing else: the web app cannot express a stored-state field,
  so adding hidden information to a game module costs zero client changes.
- The `state` columns are typed at the schema (`jsonb(...).$type<Json>()`), so the cast to
  `RawGameState` no longer has to be repeated at every call site — the seam owns the one that
  remains.

Enforced, not just documented: `scripts/check-projection.mjs` (`pnpm check:projection`,
`.github/workflows/contracts.yml`) fails the build if `projectStateFor` is called outside the seam,
if `RawGameState` is cast or named outside it, if `rawGameState()` is called anywhere but the seam
and the room runtime, if `apps/web` names any stored-state type, or if `getPublicSnapshot` comes
back.

Two follow-ups this ADR deliberately leaves open:

- Chat messages embed the *sending viewer's* projected state as their snapshot, so the author's
  `you` index is stored in shared history. Harmless today (the chat UI reads dice and holds only),
  but a hidden-information game should store a spectator projection instead.
- Spectators are refused at `subscribe` (`not_seated`) until M2-1 admits them; the projection
  already has the `{kind: "spectator"}` branch they will use.

## Alternatives considered

- **Keep `getPublicSnapshot`, add `getSpectatorSnapshot`.** Rejected: two parallel projections drift,
  and hidden information still has no per-player form.
- **Filter fields with a denylist on the server.** Rejected: leak-by-default. Projections must be
  allowlist-by-construction.
- **Generate wire types from the server implementation (`ts-rest`, tRPC).** Rejected as heavier than
  needed: the protocol is a handful of hand-authored messages over a raw WebSocket, and Zod already
  gives runtime validation plus inference with zero framework.
