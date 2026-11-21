# Roundhouse — Roadmap

Plan of record. Complements `docs/superpowers/specs/2026-08-02-yatzy-online-design.md`
(the v1 design) with the engineering sequence that gets us from "one game works" to
"the platform the spec promised".

Status as of this revision: **M0 is complete.** The live Yatzy/Yahtzee MVP is shipped and
the three implicit contracts are now enforced — per-viewer projections with a guard that
keeps them at one seam, a replayable event log with `applyEvent`, seq-based sync with
bounded resync, shared wire schemas at the handler boundary, serialised intent application,
runtime tests against real Postgres, a conformance suite every module must pass, and an ops
surface that distinguishes liveness from readiness (`pnpm typecheck` clean, 219 unit tests,
22 Postgres-backed integration tests, a 14-check end-to-end smoke, a projection guard, and
JSON logs with a bounded shutdown). The next section is M1: making the thing usable by
people who are not the author.

## Thesis

Three contracts are currently **implicit and unenforced**:

1. **What a client may see.** `GameModule.getPublicSnapshot` is declared
   (`packages/game-core/src/module.ts:30`) but never called. `apps/server/src/room/runtime.ts:354`
   ships the module's raw internal state on the wire, and the client reaches into it
   (`apps/web/src/routes/table.tsx:202-203` reads `state.dice`).
2. **What the event log means.** `game_event` is append-only and complete in _type_, but
   `dice_rolled` carries `payload: {}` (`packages/games/yatzy/src/reduce.ts:156`) — the resolved
   dice are not recorded anywhere, so state cannot be reconstructed from the log. Meanwhile
   chat writes a non-game `chat_sent` row into the same stream and bumps `game.seq`
   (`apps/server/src/ws/persistence.ts:76-89`).
3. **How a client stays in sync.** There is no incremental sync. The client responds to every
   game event by re-sending `subscribe` (`apps/web/src/routes/table.tsx:243`), which makes the
   server re-send a full snapshot plus up to 200 chat rows (`apps/server/src/ws/hub.ts:180`) and
   re-broadcast presence to the whole table.

Every planned feature — spectator, replay, async, scoreboards, a second game title — is
blocked on these three, and each becomes more expensive to change once more games exist.
So contracts come first. Features follow in the order real users need them.

## Invariants

CI should be able to prove all of these. Each one names the milestone issue that lands it.

| #   | Invariant                                                                                                                                                                       | Lands in |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| I1  | A client receives only `projectStateFor(state, viewer)` output. No raw module state crosses the wire; players and spectators receive different projections.                     | M0-2     |
| I2  | `reduce` is pure: same `(state, intent, resolvedRandom, now)` → same `(state', events)`. Modules never call `Math.random`/`Date.now`.                                           | M0-7     |
| I3  | For every reachable state, folding a module's events over `applyEvent` reproduces the state `reduce` produced. `game_event` holds game transitions only — no chat, no presence. | M0-3     |
| I4  | A client view is a function of `seq`. Gaps trigger a bounded resync; resync cost is O(new events), not O(game length).                                                          | M0-4     |
| I5  | Every registered module passes the shared conformance suite (`packages/game-testkit`).                                                                                          | M0-7     |
| I6  | Every inbound wire payload is parsed by a schema shared with the client. Handlers never see `any`.                                                                              | M0-1     |

`I1` and `I3` are the load-bearing pair: `I1` makes hidden-information games possible at all,
`I3` makes replay/spectator/audit the _same_ mechanism rather than three.

## M0 — Contracts (blocks everything)

**Why now:** these are the three implicit contracts above, plus the trust boundary and the
ops surface they touch. Nothing else should land before M0-1 through M0-4; M0-5 through M0-8
can run in parallel with them.

| ID                   | Issue                                                                                                                                                              | Depends on |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| [M0-1](../issues/11) | Wire contract: shared Zod schemas in `game-core`, typed handler boundary, per-module intent allowlist                                                              | —          |
| [M0-2](../issues/12) | Replace `getPublicSnapshot` with `projectStateFor(state, viewer)`; single server-side projection choke point                                                       | —          |
| [M0-3](../issues/13) | Event log as replay source: record resolved outcomes, add `applyEvent`, evict chat from `game_event`                                                               | —          |
| [M0-4](../issues/14) | Sync v2: seq-based incremental sync, bounded resync, presence only on membership change, paged chat backfill                                                       | M0-1, M0-2 |
| [M0-5](../issues/15) | Test the critical path: `apps/server/src/room/runtime.ts` against real Postgres (races, idempotency, seq contiguity)                                               | M0-3       |
| [M0-6](../issues/16) | CI + lint/format gates, dependabot config, compose smoke                                                                                                           | M0-1, M0-5 |
| [M0-7](../issues/17) | `packages/game-testkit` conformance suite + timeboxed hidden-information module spike (throwaway)                                                                  | M0-2, M0-3 |
| [M0-8](../issues/18) | Ops correctness: `/health` vs `/ready`, graceful shutdown, structured logs, production server image                                                                | —          |
| [M0-9](../issues/19) | Serialise intent application: `applyGameIntent` takes no table row lock today, so concurrent intents collide on `game_event_game_row_id_seq_idx` or lose an update | —          |

**Exit criteria:** all six invariants proven in CI; a scripted 50-roll game produces O(rolls)
server→client messages, not O(rolls × history); the spike either validates the module interface
or produces an ADR amendment saying what must change.

## M1 — Usable by humans who are not you

**Why now:** the MVP cannot actually be handed to friends. There is no way to leave a table, so a
guest who joins the wrong one is stuck in it and a host who closes the tab strands everyone;
and a friend who forgets a password is permanently locked out (`apps/server/src/auth.ts` is
`emailAndPassword` only, no reset flow, no verification). Both are broken flows, not rough edges.

| ID                   | Issue                                                                                                                                                     | Depends on |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [M1-1](../issues/43) | Account recovery: password reset, email verification, Google OAuth — mail behind a `Mailer` interface, `log` transport by default so dev needs no mailbox | —          |
| [M1-2](../issues/44) | Leave, kick, host transfer: `POST /:id/leave` and `/:id/kick`, contiguous seat compaction, host moves to the lowest seat, empty lobby deleted             | —          |
| [M1-3](../issues/45) | Abuse limits: extract the chat limiter, add an intent budget and better-auth rate limits, explicit `TRUST_PROXY`                                          | M1-1, M1-2 |
| [M1-4](../issues/46) | Feel and failure UX: `feedback` (sound/haptics, muted by default), one seat-label implementation, `TableNotice` per error kind, "your turn" from the view | M1-2       |
| [M1-5](../issues/47) | Self-hosting docs an operator can follow, with `scripts/check-env-docs.mjs` keeping the env reference true                                                | M1-1       |

Notes on the shape of this milestone:

- **M1-2 first.** It is the only item where the current behaviour loses a player's game: seats are
  permanent, so an invite link leads to a table nobody can leave or take over.
- **M1-4 has no timer.** A turn-timer display needs `deadlineAt` from M3-1; the milestone is
  otherwise feel-only, and each piece is a small testable module instead of an animation layer.
- **M1-5's real deliverable is the check, not the document.** A hand-written env table drifts within
  two releases; a script that fails CI when `apps/server/src/env.ts` grows an undocumented variable
  does not.
- M1-1, M1-2 and M1-5 are independent and can land in any order; M1-3 and M1-4 follow the routes
  they modify.

**Exit criteria:** a stranger with an invite link can sign up, play, leave, come back, and
recover a password, without reading source.

## M2 — Read-side community

- **M2-1** Spectator: `projectStateFor` spectator variant, `subscribe` admits non-seated
  observers (per-table opt-in), presence distinguishes watchers from players.
  Also fix the chat snapshot while here: `apps/server/src/ws/persistence.ts:32` stores the _sender's_
  projection with each message, so a hidden-information game writes that player's hand into shared
  history (findings F7 in [`m0-7-module-contract-findings.md`](m0-7-module-contract-findings.md)).
- **M2-2** Turn replay scrub driven by `applyEvent` + a checkpoint per turn; HTTP event read
  endpoint; the UI scrubs projections per event index.
- **M2-3** Post-game summary card (final scores, best category, shareable image).

**Exit criteria:** a finished game can be replayed turn by turn from the database alone.

## M3 — Async

- **M3-1** Wire the unused `gameTable.mode` column (`apps/server/src/db/schema.ts:99`), turn
  windows, `deadlineAt` in table meta, soft-no-forfeit, "waiting on X" UI.
- **M3-2** Web push "your turn" (VAPID + `vite-plugin-pwa` service worker + subscription table).
- **M3-3** Notification preferences and quiet hours.

**Exit criteria:** a 4-player table can be played across three days without anyone babysitting
the tab.

## M4 — Stats

- **M4-1** Crews + played-with graph derived from finished `game` rows.
- **M4-2** Stat queries (head-to-head, per-category averages) as materialized views.

## M5 — Prove the platform

- **M5-0** ✅ Make adding a game data-driven —
  [#39](https://github.com/jyyyeung/roundhouse/issues/39). `GameModule` declares `playerCount`,
  `defaultConfig` and `configSchema`; `GET /api/games` derives a catalogue; the lobby renders
  whatever the catalogue offers and asks the game for its own config controls; the table route no
  longer reads dice. Decided in [ADR 0004](adr/0004-games-are-data.md); a sixth guard rule
  (`no-game-branch`) fails the build when platform code names a game.
- **M5-1** ✅ Second real title with hidden information —
  [#40](https://github.com/jyyyeung/roundhouse/issues/40). "Duel": two seats, three cards, both pick
  in secret, the round reveals. Added as a package plus two registry lines, which is the proof M5-0
  was for. The contract decision came out the other way from the expected F2 fix: instead of
  projecting event payloads per viewer, an event is defined as a public fact and a pick enters the
  log only when it is revealed ([ADR 0005](adr/0005-secrets-enter-the-log-at-the-reveal.md)), so the
  hub is untouched. F2 stays open, narrowed to games that must log a private input before it is
  public.
- **M5-2** ✅ Authoring guide: [`adding-a-game.md`](adding-a-game.md) — the module contract, the two
  registry entries, the client view props and the conformance suite, with a checklist.

## Guardrails (still non-goals)

From the v1 spec, unchanged: no native store apps, no AI opponents, no 3D/WebGL dice, no
seasons/custom crew metrics, no unauthenticated guests, no second title _before_ M0 exists.

## ADRs

| ADR                                                     | Decision                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [0001](adr/0001-projections-and-wire-contract.md)       | Per-viewer projections, one server-side choke point, schemas as the single source of wire types |
| [0002](adr/0002-event-log-as-replay-source.md)          | Events are replay input via `applyEvent`; game log is game-only                                 |
| [0003](adr/0003-client-sync-model.md)                   | Seq-versioned incremental sync with bounded resync                                              |
| [0005](adr/0005-secrets-enter-the-log-at-the-reveal.md) | A secret is state until it is revealed; only public facts enter the event log                   |
| [0004](adr/0004-games-are-data.md)                      | Games declare `playerCount`/config and register in two maps; platform code names no game        |
