/**
 * End-to-end smoke test for a running Roundhouse stack.
 *
 * Unit tests fake the database, the WebSocket layer, and the auth provider; none
 * of them would notice a wrong PUBLIC_WEB_URL (cookie rejected), a broken
 * migration, a route that 500s only against real Postgres, or a WebSocket upgrade
 * that kills the process. This script exercises those paths against a live
 * server, using nothing but Node built-ins, so it stays runnable in CI and in a
 * container with no toolchain beyond Node.
 *
 * Configuration (all optional):
 *   SMOKE_BASE_URL    HTTP origin of the API      default http://localhost:3001
 *   SMOKE_WEB_ORIGIN  origin sent as `Origin`     default http://localhost:5173
 *
 * SMOKE_WEB_ORIGIN must match the server's PUBLIC_WEB_URL, because better-auth
 * rejects requests whose Origin is not trusted. Compose serves the web bundle on
 * :8080, so `SMOKE_WEB_ORIGIN=http://localhost:8080` is the right value there.
 *
 * It creates one throwaway account and one throwaway table per run, both named
 * with a `smoke-` prefix and a timestamp. It cannot delete them (there is no
 * table-delete route yet), so point it at a disposable database; on a dev stack
 * `just db-reset` discards them.
 */
const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const webOrigin = process.env.SMOKE_WEB_ORIGIN ?? "http://localhost:5173";
const password = "Smoke-password-12345";
const stamp = Date.now();
const emailA = `smoke-a-${stamp}@example.test`;
const emailB = `smoke-b-${stamp}@example.test`;

/** @type {{ name: string, ok: boolean, detail: string }[]} */
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Collects the `name=value` pairs of every Set-Cookie into one Cookie header. */
function cookieHeader(response) {
  return (response.headers.getSetCookie?.() ?? []).map((cookie) => cookie.split(";")[0]).join("; ");
}

async function jsonRequest(path, { body, cookie, method = "POST" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      // Only declare a JSON body when there is one: better-auth answers 400 to a
      // POST that announces `content-type: application/json` with an empty body,
      // which is exactly what sign-out sends.
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      origin: webOrigin,
      ...(cookie ? { cookie } : {}),
    },
    method,
  });
  return { body: await response.text(), response };
}

async function signIn(email) {
  const { response } = await jsonRequest("/api/auth/sign-in/email", { body: { email, password } });
  return { cookie: cookieHeader(response), ok: response.ok, response };
}

/**
 * An upgrade with no session cookie must be refused. Node's WebSocket client
 * cannot send a Cookie header, so the authenticated subscribe path stays covered
 * by apps/server/src/ws/hub.test.ts instead.
 */
async function checkUnauthenticatedUpgrade() {
  const url = `${baseUrl.replace(/^http/, "ws")}/ws`;
  if (typeof WebSocket === "undefined") {
    check("ws upgrade without a session is refused", false, "global WebSocket missing (needs Node 22+)");
    return;
  }
  // The server answers with an `error` frame and then closes 4401. Both matter: the
  // frame is what a client can actually read, the close code is what a proxy sees.
  const seen = { close: null, frame: null };
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    const socket = new WebSocket(url);
    const done = () => {
      clearTimeout(timer);
      socket.close();
      resolve();
    };
    socket.addEventListener("message", (event) => {
      seen.frame = JSON.parse(String(event.data).slice(0, 200));
      if (seen.close) done();
    });
    socket.addEventListener("error", () => {});
    socket.addEventListener("close", (event) => {
      seen.close = `${event.code}:${event.reason}`;
      if (seen.frame) done();
    });
  });
  check(
    "ws upgrade without a session is refused",
    seen.frame?.type === "error" && seen.frame?.code === "not_authenticated" && seen.close === "4401:not_authenticated",
    `frame=${JSON.stringify(seen.frame)} close=${seen.close}`,
  );
}

async function main() {
  const health = await fetch(`${baseUrl}/health`);
  const healthBody = await health.text();
  check("GET /health", health.ok, `${health.status} ${healthBody.slice(0, 80)}`);

  let { body, response } = await jsonRequest("/api/auth/sign-up/email", {
    body: { email: emailA, name: "smoke-a", password },
  });
  check("sign-up/email", response.ok, `${response.status} ${body.slice(0, 120)}`);
  let cookieA = cookieHeader(response);

  ({ body, response } = await jsonRequest("/api/auth/sign-up/email", {
    body: { email: emailB, name: "smoke-b", password },
  }));
  check("sign-up/email (second player)", response.ok, `${response.status} ${body.slice(0, 120)}`);
  const cookieB = cookieHeader(response);

  const signedIn = await signIn(emailA);
  check("sign-in/email", signedIn.ok, `${signedIn.response.status}`);
  cookieA = signedIn.cookie || cookieA;

  ({ body, response } = await jsonRequest("/api/tables/mine", { cookie: cookieA, method: "GET" }));
  check("GET /api/tables/mine with a session", response.ok, `${response.status} ${body.slice(0, 80)}`);

  ({ response } = await jsonRequest("/api/auth/sign-in/email", {
    body: { email: emailA, password: "wrong-password-99999" },
  }));
  check("wrong password is rejected", response.status === 401, `status ${response.status}`);

  ({ response } = await jsonRequest("/api/tables/mine", { method: "GET" }));
  check("unauthenticated /api/tables/mine is 401", response.status === 401, `status ${response.status}`);

  ({ body, response } = await jsonRequest("/api/tables", {
    body: { config: { ruleset: "yatzy" }, gameId: "yatzy" },
    cookie: cookieA,
  }));
  let tableId;
  let code;
  try {
    ({ tableId, code } = JSON.parse(body));
  } catch {
    // Left undefined so the failure below reports the raw body.
  }
  check("POST /api/tables", response.ok && Boolean(tableId && code), `${response.status} ${body.slice(0, 160)}`);

  if (code) {
    ({ body, response } = await jsonRequest("/api/tables/join", { body: { code }, cookie: cookieB }));
    check("POST /api/tables/join by invite code", response.ok, `${response.status} ${body.slice(0, 160)}`);

    ({ body, response } = await jsonRequest("/api/tables/mine", { cookie: cookieB, method: "GET" }));
    check("joined table is visible to the second player", response.ok && body.includes(tableId ?? ""), `${response.status}`);
  }

  ({ response } = await jsonRequest("/api/auth/sign-out", { cookie: cookieA }));
  check("sign-out (empty body POST)", response.ok, `status ${response.status}`);

  ({ body, response } = await jsonRequest("/api/auth/get-session", { cookie: cookieA, method: "GET" }));
  check("get-session after sign-out is empty", body.trim() === "null", `${response.status} ${body.slice(0, 60)}`);

  await checkUnauthenticatedUpgrade();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error(`\nFailed: ${failed.map((result) => result.name).join(", ")}`);
    console.error(
      `Left behind for inspection: ${emailA}, ${emailB}${tableId ? `, table ${tableId}` : ""} — ` +
        "run `just db-reset` to discard the dev database.",
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("smoke test crashed:", error);
  process.exitCode = 1;
});
