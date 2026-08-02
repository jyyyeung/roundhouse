## Task 14 report

### Status

`DONE_WITH_CONCERNS`

### Automated verification

- `pnpm test`: pass
- `pnpm typecheck`: pass

### Compose verification

- `docker compose up --build -d`: pass
- `docker compose ps`: `db` healthy, `server` up on `3001`, `web` up on `8080`
- `GET http://localhost:3001/health`: `200 {"ok":true}`
- `GET http://localhost:8080`: `200 text/html`

### HTTP MVP verification

Script: `.superpowers/sdd/task-14-e2e.mjs`

Ran:

```bash
node .superpowers/sdd/task-14-e2e.mjs
```

Passed:

- Better Auth HTTP sign-up for two fresh users via `POST /api/auth/sign-up/email`
- Cookie-backed authenticated `GET /api/tables/mine`
- Create table via `POST /api/tables`
- Join table via `POST /api/tables/join`
- Start table via `POST /api/tables/:id/start`
- Repeated create/join/start flow for both `yatzy` and `yahtzee`
- Verified both users see the started table and active game state from `/api/tables/mine`

### Gaps / concerns

- Not verified here: websocket subscribe/play/chat, full live game completion, rematch, or PWA install/Add to Home Screen. Those still need browser-based acceptance.
- Observed: `currentGame.state.tableId` falls back to `"yatzy"` instead of the concrete table UUID in both rulesets. The enclosing `currentGame.tableId` is correct, so the HTTP MVP path still passed, but this is worth checking before the browser/WS pass.

### Fix (post-report)

- `startTable` / `rematchTable` now pass `{ ...config, tableId: table.id }` into `createInitialState`.
- Server typecheck + vitest: pass.
- Commit: `fix(server): pass real tableId into game initial state`

### Final review fixes

- WebSocket subscribe/chat now reject unseated users with `not_seated` before subscribing, rate limiting, persistence, or broadcast.
- Invite-link table pages only open WS after a successful join or an authenticated seat check confirms the user already belongs to the table.
- `joinTable`, `startTable`, and `rematchTable` now lock the table row, keep join retries idempotent, and reuse an existing active game instead of creating duplicates.
- Table creation validates Yatzy config rulesets, the Yatzy module coerces unknown rulesets back to `yatzy`, and `set_holds` now requires a 5-item boolean array.
- Added regression coverage for unseated subscribe/chat, failed invite joins, invalid create config, and invalid `set_holds` payloads.

### Final review verification

- `pnpm test`: pass (`packages/game-core` 3, `packages/games/yatzy` 21, `apps/server` 10, `apps/web` 11)
- `pnpm typecheck`: pass (all 4 workspace packages)
- Targeted regressions:
  - `pnpm test src/ws/hub.test.ts src/ws/chat.test.ts src/http/tables.test.ts` in `apps/server`: pass
  - `pnpm test src/routes/table.test.tsx` in `apps/web`: pass
  - `pnpm test src/reduce.test.ts` in `packages/games/yatzy`: pass
- Commit: `pending`
