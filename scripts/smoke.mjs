import { readFile } from "node:fs/promises";

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
 *   SMOKE_SERVER_LOG  a growing copy of the server's stdout; when set, the
 *                     password-reset round trip reads the mailed link from it
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
const serverLog = process.env.SMOKE_SERVER_LOG;
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

/**
 * Reads the reset link out of the server's log.
 *
 * The default mail transporter writes the message to the log instead of a
 * mailbox, which is the only way a stack with no SMTP server can prove the
 * whole flow: request, mail, click, new password. Polls because the send may
 * still be in flight when the request returns.
 */
async function waitForResetLink(file, email, timeoutMs = 15_000) {
  const pattern = /https?:\/\/[^\s"']*\/reset-password\?token=[A-Za-z0-9._~-]+/g;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const text = await readFile(file, "utf8").catch(() => "");
    const links = text
      .split("\n")
      .filter((line) => line.includes(email))
      .flatMap((line) => line.match(pattern) ?? []);
    if (links.length > 0) return links.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
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
    check(
      "ws upgrade without a session is refused",
      false,
      "global WebSocket missing (needs Node 22+)",
    );
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
    seen.frame?.type === "error" &&
      seen.frame?.code === "not_authenticated" &&
      seen.close === "4401:not_authenticated",
    `frame=${JSON.stringify(seen.frame)} close=${seen.close}`,
  );
}

async function main() {
  const health = await fetch(`${baseUrl}/health`);
  const healthBody = await health.text();
  check("GET /health", health.ok, `${health.status} ${healthBody.slice(0, 80)}`);

  // Readiness is a different promise from liveness: it may only pass when the
  // database and the migrations both answer.
  const ready = await fetch(`${baseUrl}/ready`);
  const readyBody = await ready.json().catch(() => ({}));
  check(
    "GET /ready",
    ready.ok && readyBody.ok === true,
    `${ready.status} ${JSON.stringify(readyBody).slice(0, 160)}`,
  );

  // The lobby is a client of this catalogue: it offers exactly what the server
  // says it can host, so an empty or shapeless catalogue breaks the first screen.
  const catalogueResponse = await fetch(`${baseUrl}/api/games`);
  const catalogue = await catalogueResponse.json().catch(() => ({}));
  const yatzy = catalogue.games?.find?.((entry) => entry.id === "yatzy");
  check(
    "GET /api/games",
    catalogueResponse.ok &&
      Boolean(yatzy) &&
      yatzy.playerCount?.min === 2 &&
      yatzy.playerCount?.max === 6 &&
      yatzy.defaultConfig?.ruleset === "yatzy",
    `${catalogueResponse.status} ${JSON.stringify(catalogue).slice(0, 160)}`,
  );

  // A second title proves "adding a game" is data, not a code path (ADR 0004):
  // if this ever needs a server edit to appear, the catalogue is not derived.
  const duel = catalogue.games?.find?.((entry) => entry.id === "duel");
  check(
    "GET /api/games (second title)",
    Boolean(duel) &&
      duel.playerCount?.min === 2 &&
      duel.playerCount?.max === 2 &&
      duel.defaultConfig?.rounds === 3,
    JSON.stringify(duel ?? null).slice(0, 160),
  );

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
  check(
    "GET /api/tables/mine with a session",
    response.ok,
    `${response.status} ${body.slice(0, 80)}`,
  );

  ({ response } = await jsonRequest("/api/auth/sign-in/email", {
    body: { email: emailA, password: "wrong-password-99999" },
  }));
  check("wrong password is rejected", response.status === 401, `status ${response.status}`);

  ({ response } = await jsonRequest("/api/tables/mine", { method: "GET" }));
  check(
    "unauthenticated /api/tables/mine is 401",
    response.status === 401,
    `status ${response.status}`,
  );

  // No config: the module's own `defaultConfig` must fill it in, which is what
  // keeps a new game from needing a branch in the create route.
  ({ body, response } = await jsonRequest("/api/tables", {
    body: { gameId: "yatzy" },
    cookie: cookieA,
  }));
  let tableId;
  let code;
  try {
    ({ tableId, code } = JSON.parse(body));
  } catch {
    // Left undefined so the failure below reports the raw body.
  }
  check(
    "POST /api/tables",
    response.ok && Boolean(tableId && code),
    `${response.status} ${body.slice(0, 160)}`,
  );

  if (code) {
    ({ body, response } = await jsonRequest("/api/tables/join", {
      body: { code },
      cookie: cookieB,
    }));
    check(
      "POST /api/tables/join by invite code",
      response.ok,
      `${response.status} ${body.slice(0, 160)}`,
    );

    ({ body, response } = await jsonRequest("/api/tables/mine", {
      cookie: cookieB,
      method: "GET",
    }));
    check(
      "joined table is visible to the second player",
      response.ok && body.includes(tableId ?? ""),
      `${response.status}`,
    );

    // A seat you cannot give up strands a player forever (ADR 0006): leaving a
    // lobby must delete the seat and take the table out of the leaver's list.
    ({ body, response } = await jsonRequest(`/api/tables/${tableId}/leave`, {
      cookie: cookieB,
    }));
    check(
      "POST /api/tables/:id/leave",
      response.ok && body.includes('"removed":true'),
      `${response.status} ${body.slice(0, 160)}`,
    );

    ({ body, response } = await jsonRequest("/api/tables/mine", {
      cookie: cookieB,
      method: "GET",
    }));
    check(
      "a left table disappears from /api/tables/mine",
      response.ok && !body.includes(tableId ?? ""),
      `${response.status}`,
    );
  }

  ({ response } = await jsonRequest("/api/auth/sign-out", { cookie: cookieA }));
  check("sign-out (empty body POST)", response.ok, `status ${response.status}`);

  ({ body, response } = await jsonRequest("/api/auth/get-session", {
    cookie: cookieA,
    method: "GET",
  }));
  check(
    "get-session after sign-out is empty",
    body.trim() === "null",
    `${response.status} ${body.slice(0, 60)}`,
  );

  // Account recovery, end to end: ask for a link, find the mail the server
  // wrote, spend the token, and sign in with the new password. Only possible
  // when the caller can see the server's log, which the compose smoke does.
  if (serverLog) {
    const newPassword = "Smoke-password-67890";

    const known = await jsonRequest("/api/auth/request-password-reset", {
      body: { email: emailA },
    });
    check(
      "request-password-reset accepts a known address",
      known.response.ok,
      `${known.response.status}`,
    );

    // Identical bytes either way, or the endpoint becomes an account oracle.
    const unknown = await jsonRequest("/api/auth/request-password-reset", {
      body: { email: `smoke-nobody-${stamp}@example.test` },
    });
    check(
      "an unknown address gets the same answer",
      unknown.response.status === known.response.status && unknown.body === known.body,
      `${unknown.response.status}`,
    );

    const link = await waitForResetLink(serverLog, emailA);
    check(
      "the reset link reaches the mailer",
      Boolean(link),
      link ? `${link.slice(0, 48)}...` : "not found in the server log",
    );

    const token = link ? new URL(link).searchParams.get("token") : null;
    if (token) {
      ({ response } = await jsonRequest("/api/auth/reset-password", {
        body: { newPassword, token },
      }));
      check("reset-password spends the mailed token", response.ok, `${response.status}`);

      const spent = await jsonRequest("/api/auth/reset-password", {
        body: { newPassword: `${newPassword}x`, token },
      });
      check(
        "the same token cannot be spent twice",
        spent.response.status === 400,
        `${spent.response.status}`,
      );

      const resigned = await jsonRequest("/api/auth/sign-in/email", {
        body: { email: emailA, password: newPassword },
      });
      check("the new password signs in", resigned.response.ok, `${resigned.response.status}`);
    } else {
      check("reset-password spends the mailed token", false, "no token");
      check("the same token cannot be spent twice", false, "no token");
      check("the new password signs in", false, "no token");
    }
  }

  // An unlimited sign-in endpoint is an offline password guess with a network
  // round trip. The budget has to be observable from outside: a unit test can
  // prove the arithmetic, not that a deployed stack refuses the eleventh try.
  const attempts = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const limited = await jsonRequest("/api/auth/sign-in/email", {
      body: { email: emailA, password: "wrong-password-99999" },
    });
    attempts.push(limited.response.status);
  }
  const firstLimited = attempts.indexOf(429);
  check(
    "rapid sign-ins are rate limited",
    firstLimited !== -1 && attempts.slice(firstLimited).every((status) => status === 429),
    `statuses ${attempts.join(",")}`,
  );

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
