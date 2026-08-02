Status: implemented

Commits:
- feat(devops): add self-host Docker Compose stack

Smoke:
- `pnpm --filter @yatzy/web build` ✅
- `docker compose up --build -d` ✅
- `curl -sf http://localhost:3001/health` -> `{"ok":true}` ✅
- `curl -sfI http://localhost:8080` -> `HTTP/1.1 200 OK` ✅

Concerns:
- `.env.example` now defaults to the Compose-friendly `db` hostname; local non-Docker runs need `localhost` for Postgres.

Report path: `.superpowers/sdd/task-13-report.md`
