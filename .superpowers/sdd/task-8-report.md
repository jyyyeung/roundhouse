Status: done
TDD:
- RED: `pnpm --filter @yatzy/server test -- src/ws/handlers.test.ts` failed with `Cannot find module './handlers'`
- GREEN: `pnpm --filter @yatzy/server test -- src/ws/handlers.test.ts` passed after `ws/handlers.ts`, `ws/hub.ts`, runtime intent application, and WS bootstrap wiring were added
Tests:
- `pnpm --filter @yatzy/server test` passed
- `pnpm --filter @yatzy/server typecheck` passed
- `pnpm test` passed
- `pnpm typecheck` passed
Concerns:
- no manual two-browser smoke was run in this task
- subscribe/auth/presence flow is wired but only the illegal-action path is covered by automated tests so far
