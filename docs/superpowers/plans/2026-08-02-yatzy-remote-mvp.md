# Yatzy Remote MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a phone-first PWA where authenticated friends create/join a live table, play Yatzy or Yahtzee, chat with server-built dice snapshots, rematch, and run the stack via Docker Compose.

**Architecture:** pnpm monorepo with game-agnostic room/auth/chat (`game-core` + server shell) and a pluggable `yatzy` game module. Authoritative Node server over WebSockets; React PWA client; Postgres persistence with append-only events.

**Tech Stack:** pnpm workspaces, TypeScript, Vitest, Hono, `ws`, Drizzle ORM, Postgres, Better Auth (email/password), Vite, React 19, Tailwind CSS, shadcn/Radix, Motion, vite-plugin-pwa, Docker Compose.

## Scope

**This plan = Phase 1 (Remote MVP) only.** Separate plans later for: spectator/replay UI, async mode, crews/scoreboards, extra games, polished self-host docs.

## Global Constraints

- Package manager: **pnpm** only (never npm/yarn for installs).
- Clients: **PWA only** for v1 — no App Store / React Native.
- Auth: **required**; Better Auth with **email/password** (Google OAuth optional later); must work offline-of-SaaS for self-host.
- Games: pluggable modules; MVP ships **`yatzy` only** with `ruleset: "yatzy" | "yahtzee"`.
- Server is **authoritative**; clients never supply dice RNG or trusted chat snapshots.
- Invite codes: length **6–8**, safe alphabet (no ambiguous `0/O/1/I`).
- Soft seat default: **4**; host starts the game (not auto-start on full).
- Event envelope: `{ gameId, type, ... }` — types are module-local strings (`dice_rolled`), always paired with `gameId`.
- UI: Tailwind + custom play surface; shadcn/Radix for sheets/dialogs only; Motion for roll/hold/score.
- Config: **environment variables only**; Docker Compose must bring up web + server + postgres.

---

## File Structure

```
/
├── package.json                          # pnpm workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docker-compose.yml
├── .env.example
├── apps/
│   ├── web/                              # Vite React PWA
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── public/manifest.webmanifest
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── lib/auth-client.ts
│   │       ├── lib/ws.ts
│   │       ├── routes/login.tsx
│   │       ├── routes/lobby.tsx
│   │       ├── routes/table.tsx
│   │       ├── games/registry.tsx        # gameId → play view
│   │       ├── games/yatzy/YatzyTable.tsx
│   │       ├── games/yatzy/DiceTray.tsx
│   │       ├── games/yatzy/ScoreSheet.tsx
│   │       ├── games/yatzy/ChatPanel.tsx
│   │       └── styles.css
│   └── server/
│       ├── package.json
│       ├── src/
│       │   ├── index.ts                  # HTTP + WS bootstrap
│       │   ├── env.ts
│       │   ├── db/schema.ts
│       │   ├── db/client.ts
│       │   ├── auth.ts                   # Better Auth
│       │   ├── modules/registry.ts       # GameModule registry
│       │   ├── http/tables.ts            # create/join/start/rematch
│       │   ├── ws/hub.ts                 # rooms, broadcast, reconnect snapshot
│       │   ├── ws/handlers.ts            # intents: game + chat
│       │   └── room/runtime.ts           # in-memory table+game state
│       └── drizzle.config.ts
└── packages/
    ├── game-core/
    │   ├── package.json
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── module.ts                 # GameModule interface
    │   │   ├── events.ts                 # EventEnvelope
    │   │   ├── intents.ts                # client→server intent shapes
    │   │   ├── protocol.ts               # WS message types
    │   │   └── codes.ts                  # invite code helpers
    │   └── src/*.test.ts
    └── games/
        └── yatzy/
            ├── package.json
            ├── src/
            │   ├── index.ts              # exports yatzyModule
            │   ├── types.ts
            │   ├── categories.ts
            │   ├── score.ts
            │   ├── reduce.ts
            │   └── module.ts
            └── src/*.test.ts
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `packages/game-core/package.json`, `packages/games/yatzy/package.json`, `apps/server/package.json`, `apps/web/package.json`

**Interfaces:**
- Produces: workspace packages `@roundhouse/game-core`, `@roundhouse/game-yatzy`, `@roundhouse/server`, `@roundhouse/web` resolvable via pnpm

- [ ] **Step 1: Create root workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "packages/games/*"
```

Root `package.json`:
```json
{
  "name": "yatzy",
  "private": true,
  "scripts": {
    "test": "pnpm -r run test",
    "dev": "pnpm -r --parallel run dev",
    "build": "pnpm -r run build",
    "typecheck": "pnpm -r run typecheck"
  },
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@9.15.0"
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

`.gitignore`:
```
node_modules
dist
.env
*.log
.DS_Store
apps/web/dev-dist
```

- [ ] **Step 2: Create package stubs**

Each package gets `package.json` + `tsconfig.json` extending base, `src/index.ts` exporting a placeholder, and vitest script.

`packages/game-core/package.json`:
```json
{
  "name": "@roundhouse/game-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Mirror for `@roundhouse/game-yatzy` with dependency `"@roundhouse/game-core": "workspace:*"`.

`apps/server` and `apps/web` stubs can wait for later tasks but must exist as empty packages with name fields so the workspace is valid.

- [ ] **Step 3: Install and verify**

```bash
pnpm install
pnpm -r run typecheck
```

Expected: exit 0 (empty packages typecheck).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore packages apps
git commit -m "chore: scaffold pnpm monorepo workspaces"
```

---

### Task 2: `game-core` — module interface + protocol

**Files:**
- Create: `packages/game-core/src/module.ts`, `events.ts`, `intents.ts`, `protocol.ts`, `codes.ts`, `index.ts`
- Test: `packages/game-core/src/codes.test.ts`

**Interfaces:**
- Produces:
  - `GameModule` interface (below)
  - `EventEnvelope`, `ClientIntent`, WS `ServerMessage` / `ClientMessage`
  - `generateInviteCode(length?: number): string`, `SAFE_ALPHABET`

- [ ] **Step 1: Write failing invite-code test**

`packages/game-core/src/codes.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SAFE_ALPHABET, generateInviteCode } from "./codes";

describe("generateInviteCode", () => {
  it("returns length 6 by default using safe alphabet", () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(6);
    for (const ch of code) expect(SAFE_ALPHABET.includes(ch)).toBe(true);
  });

  it("never includes ambiguous characters", () => {
    const code = generateInviteCode(8);
    expect(code).not.toMatch(/[0O1I]/i);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @roundhouse/game-core test
```

Expected: FAIL — cannot find module `./codes`.

- [ ] **Step 3: Implement codes + core types**

`packages/game-core/src/codes.ts`:
```ts
export const SAFE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateInviteCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SAFE_ALPHABET[bytes[i]! % SAFE_ALPHABET.length]!;
  }
  return out;
}
```

`packages/game-core/src/module.ts`:
```ts
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type EventEnvelope = {
  id: string;
  tableId: string;
  gameId: string;
  seq: number;
  type: string;
  actorId: string | null;
  payload: Json;
  createdAt: string; // ISO
};

export type ReduceResult =
  | { ok: true; state: Json; events: Omit<EventEnvelope, "id" | "seq" | "createdAt">[] }
  | { ok: false; error: string };

export type ReduceContext = {
  actorId: string;
  randomInt: (maxExclusive: number) => number; // 0..maxExclusive-1
  now: () => Date;
  playerIds: string[];
};

export interface GameModule {
  id: string;
  displayName: string;
  createInitialState(config: Json, playerIds: string[]): Json;
  reduce(state: Json, intent: { type: string; payload: Json }, ctx: ReduceContext): ReduceResult;
  getPublicSnapshot(state: Json): Json;
  isFinished(state: Json): boolean;
}
```

`packages/game-core/src/protocol.ts`:
```ts
import type { Json } from "./module";

/** Client → server over WS */
export type ClientMessage =
  | { v: 1; type: "subscribe"; tableId: string }
  | { v: 1; type: "intent"; tableId: string; actionId: string; intentType: string; payload: Json }
  | { v: 1; type: "chat"; tableId: string; actionId: string; text: string };

/** Server → client over WS */
export type ServerMessage =
  | { v: 1; type: "snapshot"; tableId: string; seq: number; state: Json; meta: TableMeta }
  | { v: 1; type: "event"; tableId: string; event: import("./module").EventEnvelope }
  | { v: 1; type: "chat"; tableId: string; message: ChatWire }
  | { v: 1; type: "error"; tableId?: string; actionId?: string; code: string; message: string }
  | { v: 1; type: "presence"; tableId: string; onlineUserIds: string[] };

export type TableMeta = {
  code: string;
  gameId: string;
  config: Json;
  status: "lobby" | "active" | "finished";
  hostUserId: string;
  seatUserIds: string[];
  softSeatCap: number;
};

export type ChatWire = {
  id: string;
  userId: string;
  text: string;
  snapshot: Json;
  createdAt: string;
};
```

`packages/game-core/src/index.ts` — re-export all of the above.

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @roundhouse/game-core test
```

- [ ] **Step 5: Commit**

```bash
git add packages/game-core
git commit -m "feat(game-core): add GameModule interface and WS protocol types"
```

---

### Task 3: Yatzy scoring (pure functions)

**Files:**
- Create: `packages/games/yatzy/src/types.ts`, `categories.ts`, `score.ts`
- Test: `packages/games/yatzy/src/score.test.ts`

**Interfaces:**
- Consumes: nothing from game-core yet (pure scoring)
- Produces:
  - `Ruleset = "yatzy" | "yahtzee"`
  - `Dice = [number, number, number, number, number]` (1–6)
  - `scoreCategory(ruleset, category, dice): number`
  - category id unions per ruleset

- [ ] **Step 1: Write failing scoring tests**

```ts
import { describe, expect, it } from "vitest";
import { scoreCategory } from "./score";

describe("scoreCategory yatzy", () => {
  it("scores ones as sum of 1s", () => {
    expect(scoreCategory("yatzy", "ones", [1, 1, 2, 3, 1])).toBe(3);
  });

  it("scores one pair as highest pair face * 2", () => {
    expect(scoreCategory("yatzy", "one_pair", [3, 3, 5, 5, 2])).toBe(10);
  });

  it("scores yatzy as 50", () => {
    expect(scoreCategory("yatzy", "yatzy", [4, 4, 4, 4, 4])).toBe(50);
  });

  it("scores large straight (2-6) as 20", () => {
    expect(scoreCategory("yatzy", "large_straight", [2, 3, 4, 5, 6])).toBe(20);
  });
});

describe("scoreCategory yahtzee", () => {
  it("scores full house as 25", () => {
    expect(scoreCategory("yahtzee", "full_house", [2, 2, 2, 5, 5])).toBe(25);
  });

  it("scores small straight as 30", () => {
    expect(scoreCategory("yahtzee", "small_straight", [1, 2, 3, 4, 6])).toBe(30);
  });

  it("scores yahtzee as 50", () => {
    expect(scoreCategory("yahtzee", "yahtzee", [6, 6, 6, 6, 6])).toBe(50);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @roundhouse/game-yatzy test
```

- [ ] **Step 3: Implement categories + score**

Define Nordic Yatzy categories: `ones…sixes`, `one_pair`, `two_pairs`, `three_kind`, `four_kind`, `small_straight` (1–5 → 15), `large_straight` (2–6 → 20), `full_house` (sum of dice), `chance`, `yatzy` (50).

Define Yahtzee categories: `ones…sixes`, `three_kind` (sum), `four_kind` (sum), `full_house` (25), `small_straight` (30), `large_straight` (40), `yahtzee` (50), `chance`. Upper bonus is computed on the sheet in the reducer (63+ → +35), not in `scoreCategory`.

Implement `scoreCategory` with frequency maps; return `0` when the combination is not present (player may still assign 0 intentionally via scoring empty — reducer allows scoring any open category for the computed value, which may be 0).

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm --filter @roundhouse/game-yatzy test
```

- [ ] **Step 5: Commit**

```bash
git add packages/games/yatzy
git commit -m "feat(yatzy): add pure scoring for Yatzy and Yahtzee"
```

---

### Task 4: Yatzy turn machine (`reduce` + module)

**Files:**
- Create: `packages/games/yatzy/src/reduce.ts`, `module.ts`, `index.ts`
- Test: `packages/games/yatzy/src/reduce.test.ts`
- Modify: wire `yatzyModule: GameModule`

**Interfaces:**
- Consumes: `GameModule`, `ReduceContext` from `@roundhouse/game-core`
- Produces: `yatzyModule` with intents:
  - `{ type: "roll", payload: {} }`
  - `{ type: "set_holds", payload: { holds: boolean[5] } }`
  - `{ type: "score", payload: { category: string } }`

State shape (JSON):
```ts
type YatzyState = {
  ruleset: "yatzy" | "yahtzee";
  playerIds: string[];
  currentPlayerIndex: number;
  rollsLeft: number; // 0..3; start turn at 3, must roll before score unless house rule — MVP: must roll at least once (rollsLeft starts 3, after first roll max 2 left)
  dice: number[];    // length 5, 0 = not yet rolled this turn
  holds: boolean[];
  sheets: Record<string, Record<string, number | null>>;
  phase: "playing" | "finished";
  winnerIds: string[]; // ties allowed
};
```

- [ ] **Step 1: Write failing reduce tests**

Cover: reject roll when not your turn; roll uses `randomInt` and decrements `rollsLeft`; held dice preserved; reject score with no roll yet; score writes category and advances turn; game finishes when all categories filled; Yahtzee upper bonus applied when upper sum ≥ 63.

Use a deterministic `randomInt` stub that returns a fixed sequence.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `reduce` + `yatzyModule`**

`createInitialState(config, playerIds)` reads `config.ruleset`, builds empty sheets for all categories of that ruleset, sets first player, `rollsLeft: 3`, `dice: [0,0,0,0,0]`, `holds: [false×5]`.

`getPublicSnapshot` returns `{ gameId: "yatzy", ruleset, dice, holds, rollsLeft, currentPlayerId, sheets, phase, winnerIds }`.

`isFinished` → `state.phase === "finished"`.

- [ ] **Step 4: Run all yatzy tests — PASS**

```bash
pnpm --filter @roundhouse/game-yatzy test
```

- [ ] **Step 5: Commit**

```bash
git add packages/games/yatzy
git commit -m "feat(yatzy): implement turn reduce machine and GameModule"
```

---

### Task 5: Database schema + Drizzle

**Files:**
- Create: `apps/server/src/db/schema.ts`, `client.ts`, `drizzle.config.ts`, `apps/server/src/env.ts`
- Modify: `apps/server/package.json` (drizzle-orm, postgres, drizzle-kit, zod, dotenv)

**Interfaces:**
- Produces tables: `user`, `session`, `account`, `verification` (Better Auth), `game_table`, `table_player`, `game`, `game_event`, `chat_message`

- [ ] **Step 1: Define env schema**

`apps/server/src/env.ts`:
```ts
import { z } from "zod";

 const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(), // e.g. http://localhost:3001
  PUBLIC_WEB_URL: z.string().url(),  // e.g. http://localhost:5173
  PORT: z.coerce.number().default(3001),
});

export const env = envSchema.parse(process.env);
```

- [ ] **Step 2: Write Drizzle schema**

Key app tables (Better Auth tables match Better Auth Drizzle adapter docs — use their canonical column set):

```ts
// game_table
export const gameTable = pgTable("game_table", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  gameId: text("game_id").notNull(), // "yatzy"
  config: jsonb("config").notNull(), // { ruleset }
  mode: text("mode").notNull().default("live"),
  status: text("status").notNull(), // lobby|active|finished
  hostUserId: text("host_user_id").notNull(),
  softSeatCap: integer("soft_seat_cap").notNull().default(4),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const tablePlayer = pgTable("table_player", {
  tableId: text("table_id").notNull(),
  userId: text("user_id").notNull(),
  seatIndex: integer("seat_index").notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.tableId, t.userId] }) }));

export const game = pgTable("game", {
  id: text("id").primaryKey(),
  tableId: text("table_id").notNull(),
  gameId: text("game_id").notNull(),
  state: jsonb("state").notNull(),
  seq: integer("seq").notNull().default(0),
  status: text("status").notNull(), // active|finished
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const gameEvent = pgTable("game_event", {
  id: text("id").primaryKey(),
  gameRowId: text("game_row_id").notNull(),
  tableId: text("table_id").notNull(),
  gameId: text("game_id").notNull(),
  seq: integer("seq").notNull(),
  type: text("type").notNull(),
  actorId: text("actor_id"),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const chatMessage = pgTable("chat_message", {
  id: text("id").primaryKey(),
  tableId: text("table_id").notNull(),
  gameRowId: text("game_row_id"),
  userId: text("user_id").notNull(),
  text: text("text").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
```

- [ ] **Step 3: Add migrate script and generate migration**

```bash
pnpm --filter @roundhouse/server exec drizzle-kit generate
```

Document in README that `pnpm --filter @roundhouse/server db:migrate` applies migrations.

- [ ] **Step 4: Commit**

```bash
git add apps/server
git commit -m "feat(server): add Drizzle schema for tables, games, events, chat"
```

---

### Task 6: Better Auth (email/password)

**Files:**
- Create: `apps/server/src/auth.ts`
- Modify: `apps/server/src/index.ts` (mount handler)
- Create: `apps/web/src/lib/auth-client.ts`

**Interfaces:**
- Produces: `auth` instance; HTTP routes under `/api/auth/*`; session cookie usable from web origin; helper `getSessionFromHeaders(headers)` / cookie for WS upgrade

- [ ] **Step 1: Implement server auth**

Use Better Auth with Drizzle adapter + emailAndPassword enabled. Set `trustedOrigins: [env.PUBLIC_WEB_URL]`.

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/client";
import * as schema from "./db/schema";
import { env } from "./env";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.PUBLIC_WEB_URL],
  emailAndPassword: { enabled: true },
});
```

Mount on Hono: `app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))`.

- [ ] **Step 2: Web auth client**

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL, // http://localhost:3001
});
```

- [ ] **Step 3: Manual smoke**

Start server + web; sign up; sign in; confirm session cookie present (`curl -c -` or browser Application tab).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/auth.ts apps/server/src/index.ts apps/web/src/lib/auth-client.ts
git commit -m "feat(auth): add Better Auth email/password"
```

---

### Task 7: HTTP table APIs (create / join / start / rematch)

**Files:**
- Create: `apps/server/src/http/tables.ts`, `apps/server/src/modules/registry.ts`, `apps/server/src/room/runtime.ts`
- Test: `apps/server/src/http/tables.test.ts` (integration with test DB or vitest + pg; if heavy, unit-test runtime helpers with mocked db)

**Interfaces:**
- Consumes: `yatzyModule`, `generateInviteCode`, session user
- Produces:
  - `POST /api/tables` `{ gameId, config, softSeatCap? }` → `{ tableId, code }`
  - `POST /api/tables/join` `{ code }` → `{ tableId }`
  - `POST /api/tables/:id/start` (host only)
  - `POST /api/tables/:id/rematch` → new table or reset per MVP choice: **new game on same table** clearing to lobby with same seats
  - `GET /api/tables/mine` → recent tables

- [ ] **Step 1: Module registry**

```ts
import { yatzyModule } from "@roundhouse/game-yatzy";
import type { GameModule } from "@roundhouse/game-core";

const modules: Record<string, GameModule> = {
  [yatzyModule.id]: yatzyModule,
};

export function getModule(gameId: string): GameModule {
  const m = modules[gameId];
  if (!m) throw new Error(`unknown_game:${gameId}`);
  return m;
}
```

- [ ] **Step 2: Implement create/join/start**

Create: auth required; `gameId` must resolve; store row `status: lobby`; add host as seat 0.

Join: auth required; lookup by code; reject if full (`seatCount >= softSeatCap`) or status not lobby/active (allow mid-game join as spectator? **MVP: join only in lobby**).

Start: host only; status lobby; ≥2 players; create `game` row with `module.createInitialState(config, seatUserIds)`; status active; notify WS hub if wired (Task 8).

Rematch: host or any player after finished; reset to new `game` with same seats/config OR return to lobby — **pick: same table, new game row, auto-start with same seat order**.

- [ ] **Step 3: Integration test for unknown gameId and seat cap**

Assert `POST /api/tables` with `gameId: "poker"` returns 400 `unknown_game`.  
Assert 5th join to cap-4 returns 400 `table_full`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src
git commit -m "feat(server): table create, join, start, and rematch APIs"
```

---

### Task 8: WebSocket hub + game intents + reconnect

**Files:**
- Create: `apps/server/src/ws/hub.ts`, `handlers.ts`
- Modify: `apps/server/src/index.ts` (upgrade), `room/runtime.ts`
- Test: `apps/server/src/ws/handlers.test.ts`

**Interfaces:**
- Consumes: `ClientMessage` / `ServerMessage`, `GameModule.reduce`, session from cookie on upgrade
- Produces: authenticated WS; `subscribe` → snapshot; `intent` → validate → reduce → persist events → broadcast; idempotent `actionId` cache per table (TTL/map)

- [ ] **Step 1: Write failing test for out-of-turn intent**

Simulate runtime with two players; player B sends `roll`; expect `{ type: "error", code: "illegal_action" }` and unchanged seq.

- [ ] **Step 2: Implement hub**

On connect: parse session; if missing, close 4401.  
Maintain `Map<tableId, Set<WebSocket>>` and `Map<tableId, Set<userId>>` presence.  
`subscribe`: load runtime state; send `snapshot` + `presence`.  
`intent`: dedupe `actionId`; call module.reduce with server `randomInt` from `crypto`; append events with incrementing seq; persist state+events; broadcast each `event` then optional lightweight snapshot if finished.  
Reconnect path is just `subscribe` again (full snapshot).

RNG:
```ts
function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error("maxExclusive");
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % maxExclusive;
}
```
For dice faces use `randomInt(6) + 1` inside the yatzy module via ctx.

- [ ] **Step 3: Pass tests + manual two-browser smoke**

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ws apps/server/src/room apps/server/src/index.ts
git commit -m "feat(server): websocket rooms with authoritative game intents"
```

---

### Task 9: Chat with server snapshots

**Files:**
- Modify: `apps/server/src/ws/handlers.ts`
- Test: `apps/server/src/ws/chat.test.ts`

**Interfaces:**
- Consumes: `module.getPublicSnapshot(state)`
- Produces: `chat` ClientMessage → persist `chat_message` + `chat_sent` event → broadcast `ServerMessage` type `chat`

- [ ] **Step 1: Failing test**

Send chat with client-provided fake dice in payload (should be ignored). Assert stored snapshot matches server state, not client.

- [ ] **Step 2: Implement**

Truncate text to 500 chars; rate-limit ~5 msg / 10s / user / table; snapshot = `getPublicSnapshot` or `{ gameId, phase: "lobby" }` if no active game.

Also append `game_event` with `type: "chat_sent"` and payload `{ chatMessageId, text }` when a game row exists.

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ws
git commit -m "feat(server): realtime chat with server-built game snapshots"
```

---

### Task 10: Web lobby + auth screens

**Files:**
- Create: `apps/web` Vite React app with Tailwind, router (`login`, `lobby`), API helpers
- Modify: `apps/web/vite.config.ts` proxy `/api` → server

**Interfaces:**
- Consumes: auth client, table HTTP APIs
- Produces: working sign-up/sign-in; create table (pick ruleset); join by code; list mine; navigate to `/t/:tableId`

- [ ] **Step 1: Scaffold Vite React + Tailwind**

```bash
# from apps/web — ensure react-router-dom, @roundhouse/game-core workspace dep
pnpm --filter @roundhouse/web add react react-dom react-router-dom
pnpm --filter @roundhouse/web add -D tailwindcss @tailwindcss/vite typescript @types/react @types/react-dom vite @vitejs/plugin-react
```

Phone-first CSS variables for a bright playful theme (avoid purple-on-white / Inter).

- [ ] **Step 2: Login page** — email/password forms via `authClient.signUp.email` / `signIn.email`.

- [ ] **Step 3: Lobby page** — create (gameId fixed `yatzy`, ruleset select), join code input, recent tables list, shareable link `PUBLIC_WEB_URL/t/{tableId}?code=...` (also show raw code).

- [ ] **Step 4: Guard routes** — redirect unauthenticated users to `/login`.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): auth screens and lobby create/join"
```

---

### Task 11: Yatzy table UI + chat sheet

**Files:**
- Create: `apps/web/src/games/yatzy/*`, `apps/web/src/games/registry.tsx`, `apps/web/src/routes/table.tsx`, `apps/web/src/lib/ws.ts`
- Add: Motion animations for roll/hold/score; shadcn Sheet for chat

**Interfaces:**
- Consumes: WS protocol, yatzy public snapshot shape
- Produces: playable table; only current player enables controls; chat bubbles with dice strip

- [ ] **Step 1: WS client**

```ts
export function connectTableWs(opts: {
  apiUrl: string; // http → ws
  tableId: string;
  onMessage: (msg: ServerMessage) => void;
}): { send: (m: ClientMessage) => void; close: () => void }
```

Open with `credentials: "include"` cookies (browser WS sends cookies same-site). On open, send `subscribe`.

- [ ] **Step 2: Table route**

Load meta via snapshot; if lobby show seat list + Start (host); if active/finished render `games/registry` → `YatzyTable`.

- [ ] **Step 3: YatzyTable**

- `ScoreSheet` — all players columns; tap category on your turn to score  
- `DiceTray` — tap die to toggle hold; Roll button; Motion shake on roll  
- Turn banner + presence dots  
- Chat Sheet — messages + snapshot strip (`dice`/`holds`/`rollsLeft`)

Send intents with unique `actionId` (`crypto.randomUUID()`).

- [ ] **Step 4: Manual playtest checklist**

Two browsers: full game both rulesets; chat shows dice; refresh reconnects; rematch works.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): yatzy table play surface and chat snapshots"
```

---

### Task 12: PWA installability

**Files:**
- Modify: `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/public/manifest.webmanifest`, icons

- [ ] **Step 1: Add vite-plugin-pwa**

```ts
VitePWA({
  registerType: "autoUpdate",
  manifest: {
    name: "Yatzy",
    short_name: "Yatzy",
    display: "standalone",
    start_url: "/",
    background_color: "#FFF8E7",
    theme_color: "#E4572E",
    icons: [/* 192 + 512 png */],
  },
})
```

- [ ] **Step 2: Verify**

Build + preview; Chrome Application tab shows installability (or DevTools → Manifest with no required errors).

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): enable installable PWA manifest and service worker"
```

---

### Task 13: Docker Compose self-host path

**Files:**
- Create: `docker-compose.yml`, `apps/server/Dockerfile`, `apps/web/Dockerfile` (or nginx serving `web` dist + proxy `/api` and `/ws`), `.env.example`, `README.md` (dev + compose)

- [ ] **Step 1: Compose file**

Services: `db` (postgres:16), `server`, `web`.  
`server` waits on db healthcheck; runs migrate then start.  
Env from `.env.example` mirrored.

`.env.example`:
```
DATABASE_URL=postgres://yatzy:yatzy@db:5432/yatzy
BETTER_AUTH_SECRET=change-me-to-a-32+char-secret-value
BETTER_AUTH_URL=http://localhost:3001
PUBLIC_WEB_URL=http://localhost:8080
VITE_API_URL=http://localhost:3001
PORT=3001
```

- [ ] **Step 2: Smoke**

```bash
docker compose up --build -d
curl -sf http://localhost:3001/health
# open web, sign up, create table
```

Expected: health 200; can create table.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml apps/server/Dockerfile apps/web/Dockerfile .env.example README.md
git commit -m "feat: add Docker Compose self-host stack"
```

---

### Task 14: End-to-end MVP verification

**Files:** none new (checklist)

- [ ] **Step 1: Run automated tests**

```bash
pnpm test
pnpm typecheck
```

Expected: all green.

- [ ] **Step 2: Manual acceptance (from spec success criteria)**

1. Two users on phone-sized viewports sign up  
2. Create Yatzy table + join via code/link  
3. Play full live game  
4. Repeat with Yahtzee ruleset  
5. Chat message shows dice snapshot  
6. Rematch  
7. Add to Home Screen path documented  
8. `docker compose up` works on clean machine with `.env`

- [ ] **Step 3: Commit any fixes; tag optional `mvp-remote-1`

---

## Spec coverage (self-review)

| Spec item | Task(s) |
|-----------|---------|
| PWA phone-first | 10–12 |
| Accounts required / self-hostable auth | 6, 13 |
| Live remote MVP | 7–11 |
| Yatzy + Yahtzee configurable | 3–4, 7, 10 |
| Pluggable game modules | 2, 4, 7 |
| Chat + server dice snapshot | 9, 11 |
| Authoritative server + events | 5, 8 |
| Reconnect snapshot | 8 |
| Rematch | 7, 11 |
| Docker Compose self-host | 13 |
| Invite codes safe alphabet | 2, 7 |
| Host starts / soft cap 4 | 7 |
| Spectator/replay/async/crews | **out of scope** (later plans) |

## Follow-up plans (not this doc)

1. Social watch (spectator + replay UI on event log)  
2. Async mode + notifications  
3. Crews + played-with scoreboards  
4. Second game module proof + polished self-host docs  

---

## Execution handoff

Plan complete. Prefer **subagent-driven-development** (fresh agent per task + review) or **executing-plans** (inline batches with checkpoints).
