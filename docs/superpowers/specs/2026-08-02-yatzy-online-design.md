# Roundhouse — Design Spec

**Date:** 2026-08-02  
**Status:** Approved for planning  
**Product:** Roundhouse — real-time multiplayer party games for remote friends, starting with Yatzy/Yahtzee — phone-first installable web app, cloud- or self-hostable

## Goal

Let a group of friends play together when they cannot meet face to face: live remote tables first (Yatzy/Yahtzee), with chat that preserves game context, later spectator/replay, async play, persistent friend scoreboards, **additional games**, and **optional self-hosted deployment**.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Clients | Installable **PWA** (no App Store for v1); shareable invite links (invitees still sign in) |
| Identity | **Accounts required** (email + Google; Apple later if needed) |
| Play modes | **Live + async** both planned; **live remote MVP first** |
| Games | **Pluggable game modules**; MVP ships Yatzy + Yahtzee only |
| Rules (MVP) | Per-table ruleset within the dice module: Nordic Yatzy \| American Yahtzee |
| Scoreboards | **Crews** + **played-with** soft graph in product vision; seasons/custom stats later |
| Spectate / history | **Live spectator + turn replay + chat snapshots** (event log enables all three) |
| Table size | Soft default ~4; model stays flexible (per-game caps allowed later) |
| UI stack | Tailwind + **custom play surface**; shadcn/Radix for overlays; Motion for feedback |
| Deployment | **Cloud OK for MVP**; architecture must stay **self-hostable** (Docker Compose path) |
| Platform rejected for v1 | React Native / Expo store apps (revisit only if PWA proves insufficient) |

## Architecture

```
[PWA / Browser] --HTTPS+WS--> [API + Game Server] --SQL--> [Postgres]
                                    |
                          [packages/game-core]     shared room/table/events/chat
                          [packages/games/*]       pluggable game modules
```

- **Authoritative server:** clients send intents only; server validates via the active game module, applies RNG where needed, updates state, broadcasts.
- **Realtime:** one WebSocket room per table (game, presence, chat) — game-agnostic shell.
- **Persistence:** Postgres for users, tables, chat, append-only `GameEvent` log; hot state in memory with DB snapshots for resume/async later.
- **Shared core:** pure TypeScript packages used by server (truth) and client (UI / replay projection).

### Multi-game extension point

Lobby, auth, tables, presence, chat, reconnect, and scoreboard hooks are **game-agnostic**.

Each game is a **module** that implements a stable interface, e.g.:

```ts
interface GameModule {
  id: string                    // e.g. "yatzy"
  displayName: string
  createInitialState(config): GameState
  reduce(state, intent, ctx): { state; events } | { error }
  getPublicSnapshot(state): unknown   // for reconnect + chat context
  isFinished(state): boolean
  // optional: seatLimits, asyncDefaults, scoreboardContribution
}
```

- Server registers modules; `Table.gameId` selects which module owns the match.
- Client registers a **view** per `gameId` (dice sheet for Yatzy; future games bring their own play surface).
- `GameEvent.type` stays namespaced or carries `gameId` so foreign games do not collide (`yatzy.dice_rolled` vs generic envelope + payload).
- MVP: only `yatzy` module (with internal `ruleset: yatzy | yahtzee`). Future games = new package + UI registration, not a rewrite of rooms/chat.

### Monorepo (pnpm)

Workspace packages use the `@roundhouse/*` scope. The first game module remains `yatzy`.

- `apps/web` — Vite + React + TypeScript + PWA (`@roundhouse/web`)
- `apps/server` — Node + TypeScript (Hono) + WebSockets (`@roundhouse/server`)
- `packages/game-core` — table/room protocol, event envelope, chat snapshot hook (`@roundhouse/game-core`)
- `packages/games/yatzy` — Yatzy + Yahtzee rules, turn machine (`@roundhouse/game-yatzy`)
- (later) `packages/games/<other>` — additional modules

### Auth (self-host friendly)

Prefer **self-hostable** auth for the long term (e.g. Better Auth or Auth.js with credentials/OAuth you configure), not a SaaS-only IdP as a hard dependency.

- MVP may use a hosted OAuth app (Google) but must run with **email/password or magic link alone** in self-hosted mode.
- All secrets and OAuth client IDs via **environment variables**.
- WebSocket connections authenticated on connect; every game intent carries the authenticated user.

### Hosting & self-hosting

**MVP cloud (convenient):**

- Web: Vercel or Cloudflare Pages  
- Server: Fly.io or Railway  
- DB: managed Postgres  

**Self-host path (required capability, not day-1 polish):**

- Single **Docker Compose** stack: `web` + `server` + `postgres` (+ optional reverse proxy)
- Config entirely via env (`DATABASE_URL`, `AUTH_*`, `PUBLIC_WEB_URL`, `WS_URL`, etc.)
- No mandatory third-party services beyond what the operator chooses (OAuth providers optional)
- Stateless enough that one server replica is fine for friend-group scale; document single-node first
- Web assets can be served by the same compose stack (static nginx/Caddy) so operators are not forced onto Vercel

Cloud vs self-host is a **deployment concern**, not a product fork.

## Product surfaces

### MVP (remote game night)

1. **Lobby / home** — sign in; create table (**game** = Yatzy module, ruleset Yatzy|Yahtzee, seat soft-cap); join via code or `/t/:code`; recent/active tables.
2. **Table** — phone-first single composition: score sheet, dice tray + holds, roll/score actions (active player only), turn banner, presence, chat sheet.
3. **Chat** — realtime messages; each message stores a server-built **game snapshot** at send time (module-defined), shown as an inline strip on the bubble.
4. **Post-game** — final scores, winner, rematch or return to lobby.
5. **PWA** — installable Add to Home Screen experience for regulars.

### Later (same architecture)

- Live spectator cues on opponent turns  
- Turn replay / scrub from event log  
- Async mode (long turn windows, “your turn” notifications / web push where possible)  
- Crews + played-with scoreboards; seasons and custom metrics after that  
- **Additional game modules** (new `packages/games/*` + client views)  
- **Documented self-host / Compose install** polished for non-dev operators  

### UX principles

- Fun, happy, simple controls; large tap targets  
- Active game surface is the hero; no dashboard clutter in the first viewport of a table  
- Custom visual language (not a SaaS component look); expressive display font + clean UI font (not Inter/Roboto defaults)  
- 2–3 intentional motions (roll, hold, score) — not decorative noise  
- Lobby stays generic when more games exist; play UI is per-module  

## Data model

### Entities

- **User** — id, display name, auth identities, optional avatar  
- **Table** — invite code, **`gameId`**, game-specific `config` JSON (e.g. `{ ruleset: "yatzy" | "yahtzee" }`), mode (`live` | `async`), host, seat soft-cap, status (`lobby` | `active` | `finished`)  
- **TablePlayer** — user, seat order, connection/presence  
- **Game** — `gameId`, opaque **`state` JSON** owned by the module (for Yatzy: turn, rolls left, dice, holds, sheets); avoid baking dice-only columns into the schema  
- **GameEvent** — append-only log (`gameId`, `seq`, `type`, `actorId`, `payload`, …)  
- **ChatMessage** — author, text, **`snapshot` JSON** (module-defined shape), timestamps (canonical chat store)  
- **Crew / CrewMember / aggregates** — schema stubs allowed in MVP; product UI in phase 4; aggregates should key by `gameId` so multi-game stats stay clean  

### Event types (Yatzy module examples)

Envelope is generic; names below are module-specific payloads/types:

`player_joined` · `game_started` · `dice_rolled` · `dice_held` · `category_scored` · `turn_advanced` · `chat_sent` · `game_finished`

Shape: `{ id, gameId, tableGameId, seq, type, actorId, payload, createdAt }`.

Server applies intent through the module → events + new state. Replay = fold events in `seq` order for that module.

`chat_sent` is written to the event log for ordering/replay context; the message body + snapshot also persist as `ChatMessage` for efficient chat history queries.

### Chat snapshot

Built **only on the server** via `module.getPublicSnapshot(state)` at send time.

Yatzy MVP shape:

```ts
{
  gameId: "yatzy"
  dice: number[]       // length 5, values 1–6
  holds: boolean[]
  rollsLeft: number
  currentPlayerId: string
  lastEventSeq?: number
}
```

Future games define their own snapshot schema under the same envelope (`gameId` + payload). Clients must not supply authoritative game state in chat payloads.

### Yatzy module (`packages/games/yatzy`)

Pure functions for both rulesets, e.g. legal holds, category scores, upper bonus (Yahtzee), game-over detection. RNG is server-only (injected via reduce context).

## Flows & reliability

### Create → play

1. Host creates table (selects game module + config) → receives code/link.  
2. Friends join (authenticated) → lobby.  
3. Host starts (default); server asks module for initial state / seat order, emits `game_started`.  

### Turn (live, Yatzy)

1. Active player rolls (max 3) → server RNG → `dice_rolled`.  
2. Toggle holds → `dice_held`.  
3. Choose category → `category_scored` → `turn_advanced`.  
4. When all sheets complete → `game_finished`.  

### Reconnect

On WS reconnect: authenticate → subscribe → server sends full state snapshot + current `seq` (module public state). Snapshot is authoritative; clients replace local state.

### Error / edge handling

| Case | Behavior |
|------|----------|
| Out-of-turn / illegal action | Reject with error code; no state change |
| Duplicate intent | Idempotent via client `actionId` or module-level ignore |
| Host leaves lobby | Transfer host to next seated player |
| Disconnect mid-turn (live) | Keep turn; soft timers optional later |
| Page refresh | Restore from snapshot; skip mid-animation |
| Unknown `gameId` | Reject table create/join; never crash the room server |

### Security

- Auth on every intent  
- Rate-limit chat  
- Invite codes from a safe alphabet, length 6–8  
- Snapshots contain only public table state  

## UI libraries (locked)

- **Tailwind CSS** — layout, tokens, phone breakpoints  
- **Custom components** — per-game play surface (dice/score sheet for Yatzy)  
- **shadcn/ui + Radix** — sheet (chat), dialog, menus, auth forms only  
- **Motion** — roll / hold / score feedback  
- **Icons** — lucide-react or custom; avoid emoji-kit UIs  

## Testing

- **Highest ROI:** unit tests in `packages/games/yatzy` for both rulesets and turn machine; contract tests that every module satisfies `GameModule`  
- **Server:** integration tests for illegal moves, reconnect snapshot, chat snapshot attachment, unknown gameId rejection  
- **Web:** light smoke (create/join); Playwright optional later  
- **Self-host:** Compose smoke (up → migrate → health → create table) before calling self-host “supported”  

## Phasing

1. **Remote MVP** — auth, lobby, live Yatzy/Yahtzee table, chat + snapshot, rematch, PWA; game-module boundary in place  
2. **Social watch** — live spectator + turn replay from event log  
3. **Async mode** — long turns + notifications  
4. **Scoreboards** — crews + played-with (keyed by game where relevant)  
5. **Platform hardening** — polished Docker Compose self-host docs; optional extra game module as proof of pluggability  

## Non-goals (v1)

- App Store / Play Store native binaries  
- Seasons and custom crew metrics  
- Spectate-only unauthenticated guests  
- AI opponents  
- 3D / WebGL dice engines  
- Shipping a second game title in MVP  
- Fully polished one-click self-host UX on day one (capability + Compose skeleton yes; operator polish can wait)  

## Open defaults (can change without redesign)

- Lobby start: **host starts** (not auto-start on full)  
- Soft seat default: **4**  
- Auth library: prefer Better Auth or Auth.js (self-hostable); avoid Clerk as a hard requirement  
- Exact invite-code alphabet/length within 6–8 safe chars  
- Event type naming: namespaced strings vs `{ gameId, type }` — pick one convention in implementation and stick to it  

## Success criteria (MVP)

- Two or more friends on phones can create/join via link, play a full live Yatzy or Yahtzee game, chat with visible dice context, and rematch — without installing from an app store.
- Code layout allows a future game module without rewriting rooms/auth/chat.
- A developer can run the stack via Docker Compose against local Postgres with env-only config (even if docs are still minimal).
