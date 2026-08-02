Status: implemented

Commits:
- feat(web): add live Yatzy table UI with chat sheet snapshots

Typecheck/test:
- `pnpm typecheck` ✅
- `pnpm test` ✅

Concerns:
- Manual two-browser playtest deferred; no live DB/session environment in this run.
- Client re-subscribes for fresh snapshots after game events because WS event payloads do not include enough dice state to reconstruct rolls locally.

Report path: `.superpowers/sdd/task-11-report.md`
