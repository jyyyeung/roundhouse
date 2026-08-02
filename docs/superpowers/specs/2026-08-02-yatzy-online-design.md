# Yatzy Online — Design Spec

**Date:** 2026-08-02  
**Status:** Approved for planning  
**Product:** Real-time Yatzy/Yahtzee for remote friends, phone-first installable web app

## Goal

Let a group of friends play Yatzy (and Yahtzee) together when they cannot meet face to face: live remote tables first, with chat that preserves game context, later spectator/replay, async play, and persistent friend scoreboards.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Clients | Installable **PWA** (no App Store for v1); shareable invite links (invitees still sign in) |
| Identity | **Accounts required** (email + Google; Apple later if needed) |
| Play modes | **Live + async** both planned; **live remote MVP first** |
| Rules | **Configurable** per table: Nordic Yatzy and American Yahtzee |
| Scoreboards | **Crews** + **played-with** soft graph in product vision; seasons/custom stats later |
| Spectate / history | **Live spectator + turn replay + chat dice snapshots** (event log enables all three) |
| Table size | Soft default ~4; model stays flexible |
| UI stack | Tailwind + **custom play surface**; shadcn/Radix for overlays; Motion for feedback |
| Platform rejected for v1 | React Native / Expo store apps (revisit only if PWA proves insufficient) |

## Architecture

```
[PWA / Browser] --HTTPS+WS--> [API + Game Server] --SQL--> [Postgres]
                                    |
                             [packages/game]
                          rules + turn machine
                          + event types
```

- **Authoritative server:** clients send intents only; server validates, rolls RNG, updates state, broadcasts.
- **Realtime:** one WebSocket room per table (game, presence, chat).
- **Persistence:** Postgres for users, tables, chat, append-only `GameEvent` log; hot state in memory with DB snapshots for resume/async later.
- **Shared core:** pure TypeScript package used by server (truth) and client (UI / replay projection).

### Monorepo (pnpm)

- `apps/web` — Vite + React + TypeScript + PWA
- `apps/server` — Node + TypeScript (Fastify or Hono) + WebSockets
- `packages/game` — rulesets, scoring, turn machine, event schemas

### Auth

Session via Better Auth, Clerk, or Auth.js. WebSocket connections authenticated on connect. Every game intent carries the authenticated user.

### Hosting (MVP)

- Web: Vercel or Cloudflare Pages  
- Server: Fly.io or Railway  
- DB: managed Postgres  

## Product surfaces

### MVP (remote game night)

1. **Lobby / home** — sign in; create table (ruleset, seat soft-cap); join via code or `/t/:code`; recent/active tables.
2. **Table** — phone-first single composition: score sheet, dice tray + holds, roll/score actions (active player only), turn banner, presence, chat sheet.
3. **Chat** — realtime messages; each message stores a server-built **dice/status snapshot** at send time, shown as an inline strip on the bubble.
4. **Post-game** — final scores, winner, rematch or return to lobby.
5. **PWA** — installable Add to Home Screen experience for regulars.

### Later (same architecture)

- Live spectator cues on opponent turns  
- Turn replay / scrub from event log  
- Async mode (long turn windows, “your turn” notifications / web push where possible)  
- Crews + played-with scoreboards; seasons and custom metrics after that  

### UX principles

- Fun, happy, simple controls; large tap targets  
- Score sheet + dice are the hero; no dashboard clutter in the first viewport of a table  
- Custom visual language (not a SaaS component look); expressive display font + clean UI font (not Inter/Roboto defaults)  
- 2–3 intentional motions (roll, hold, score) — not decorative noise  

## Data model

### Entities

- **User** — id, display name, auth identities, optional avatar  
- **Table** — invite code, ruleset (`yatzy` | `yahtzee`), mode (`live` | `async`), host, seat soft-cap, status (`lobby` | `active` | `finished`)  
- **TablePlayer** — user, seat order, connection/presence  
- **Game** — current turn, rolls remaining, dice[5], holds[5], per-player scoresheet  
- **GameEvent** — append-only log (source of truth for spectator, replay, analytics)  
- **ChatMessage** — author, text, snapshot JSON, timestamps (canonical chat store)  
- **Crew / CrewMember / aggregates** — schema stubs allowed in MVP; product UI in phase 4  

### Event types

`player_joined` · `game_started` · `dice_rolled` · `dice_held` · `category_scored` · `turn_advanced` · `chat_sent` · `game_finished`

Shape: `{ id, gameId, seq, type, actorId, payload, createdAt }`.

Server applies event → new state. Replay = fold events in `seq` order.

`chat_sent` is written to the event log for ordering/replay context; the message body + snapshot also persist as `ChatMessage` for efficient chat history queries.

### Chat snapshot

Built **only on the server** from current game state at send time:

```ts
{
  dice: number[]       // length 5, values 1–6
  holds: boolean[]
  rollsLeft: number
  currentPlayerId: string
  lastEventSeq?: number
}
```

Clients must not supply authoritative dice state in chat payloads.

### Rules module (`packages/game`)

Pure functions for both rulesets, e.g. legal holds, category scores, upper bonus (Yahtzee), game-over detection. RNG is server-only.

## Flows & reliability

### Create → play

1. Host creates table → receives code/link.  
2. Friends join (authenticated) → lobby.  
3. Host starts (default); server sets seat order, emits `game_started`.  

### Turn (live)

1. Active player rolls (max 3) → server RNG → `dice_rolled`.  
2. Toggle holds → `dice_held`.  
3. Choose category → `category_scored` → `turn_advanced`.  
4. When all sheets complete → `game_finished`.  

### Reconnect

On WS reconnect: authenticate → subscribe → server sends full state snapshot + current `seq`. Snapshot is authoritative; clients replace local state.

### Error / edge handling

| Case | Behavior |
|------|----------|
| Out-of-turn / illegal category | Reject with error code; no state change |
| Duplicate roll submit | Idempotent via client `actionId` or ignore if rolls already consumed |
| Host leaves lobby | Transfer host to next seated player |
| Disconnect mid-turn (live) | Keep turn; soft timers optional later |
| Page refresh | Restore from snapshot; skip mid-animation |

### Security

- Auth on every intent  
- Rate-limit chat  
- Invite codes from a safe alphabet, length 6–8  
- Snapshots contain only public table state  

## UI libraries (locked)

- **Tailwind CSS** — layout, tokens, phone breakpoints  
- **Custom components** — dice, score sheet, turn chrome  
- **shadcn/ui + Radix** — sheet (chat), dialog, menus, auth forms only  
- **Motion** — roll / hold / score feedback  
- **Icons** — lucide-react or custom; avoid emoji-kit UIs  

## Testing

- **Highest ROI:** unit tests in `packages/game` for both rulesets and turn machine  
- **Server:** integration tests for illegal moves, reconnect snapshot, chat snapshot attachment  
- **Web:** light smoke (create/join); Playwright optional later  

## Phasing

1. **Remote MVP** — auth, lobby, live table, Yatzy + Yahtzee, chat + snapshot, rematch, PWA  
2. **Social watch** — live spectator + turn replay from event log  
3. **Async mode** — long turns + notifications  
4. **Scoreboards** — crews + played-with; seasons/custom metrics later  

## Non-goals (v1)

- App Store / Play Store native binaries  
- Seasons and custom crew metrics  
- Spectate-only unauthenticated guests  
- AI opponents  
- 3D / WebGL dice engines  

## Open defaults (can change without redesign)

- Lobby start: **host starts** (not auto-start on full)  
- Soft seat default: **4**  
- Auth vendor: pick at implementation (Better Auth vs Clerk vs Auth.js)  
- Exact invite-code alphabet/length within 6–8 safe chars  

## Success criteria (MVP)

- Two or more friends on phones can create/join via link, play a full live game under either ruleset, chat with visible dice context, and rematch — without installing from an app store.
