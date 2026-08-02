# Yatzy

## Local dev
1. Enable pnpm via Corepack: `corepack enable`
2. Install deps: `pnpm install`
3. Copy envs: `cp .env.example .env`
4. If you're running Postgres outside Docker, change `DATABASE_URL` in `.env` from `db` to `localhost`
5. Start the apps: `pnpm dev`

The web app runs on `http://localhost:5173` and the server health endpoint is `http://localhost:3001/health`.

## Docker Compose
1. Optional: `cp .env.example .env` if you want to override defaults
2. Start the stack: `docker compose up --build -d`
3. Check health: `curl -sf http://localhost:3001/health`
4. Open the app at `http://localhost:8080`

Compose starts:
- `db`: Postgres 16 with a persistent `postgres-data` volume
- `server`: runs `pnpm --filter @yatzy/server db:migrate` before starting the API/websocket server
- `web`: serves the Vite build from nginx and proxies `/api` plus `/ws` to the server container

To stop the stack, run `docker compose down`. Add `-v` if you also want to remove the Postgres volume.
