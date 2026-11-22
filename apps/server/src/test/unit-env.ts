/**
 * Unit tests never touch a database and never sign a cookie, but importing the
 * server pulls in `env.ts`, which validates the whole environment. Give the
 * schema what it needs so `pnpm test` works on a machine with no `.env`.
 *
 * The integration suites point at their own throwaway database and override
 * what matters to them; nothing here reaches a real database.
 */
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:5432/roundhouse_unused";
process.env.BETTER_AUTH_SECRET ??= "unit-test-only-secret-0123456789abcdef";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
process.env.PUBLIC_WEB_URL ??= "http://localhost:5173";
