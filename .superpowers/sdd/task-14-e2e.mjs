import { randomUUID } from "node:crypto";

const serverBaseUrl = process.env.TASK14_SERVER_URL ?? "http://localhost:3001";
const webBaseUrl = process.env.TASK14_WEB_URL ?? "http://localhost:8080";

function parseSetCookie(setCookie) {
  const [pair] = setCookie.split(";", 1);
  const index = pair.indexOf("=");
  if (index === -1) return null;
  return [pair.slice(0, index), pair.slice(index + 1)];
}

class SessionClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
  }

  store(response) {
    const values =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      const parsed = parseSetCookie(value);
      if (!parsed) continue;
      this.cookies.set(parsed[0], parsed[1]);
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  async request(path, init = {}) {
    const headers = new Headers(init.headers ?? {});
    headers.set("origin", webBaseUrl);
    headers.set("referer", `${webBaseUrl}/`);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const cookie = this.cookieHeader();
    if (cookie) {
      headers.set("cookie", cookie);
    }
    const response = await fetch(`${serverBaseUrl}${path}`, {
      ...init,
      headers,
    });
    this.store(response);
    return response;
  }
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function expectJson(response, label) {
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

function findTable(tables, tableId) {
  const table = tables.find((entry) => entry.id === tableId);
  if (!table) {
    throw new Error(`table ${tableId} missing from /api/tables/mine response`);
  }
  return table;
}

async function runScenario({ host, guest, ruleset, summary }) {
  const created = await expectJson(
    await host.request("/api/tables", {
      method: "POST",
      body: JSON.stringify({
        gameId: "yatzy",
        config: { ruleset },
        softSeatCap: 4,
      }),
    }),
    `${ruleset} create table`,
  );
  summary.checks.push(`${ruleset} table create ok`);

  const joined = await expectJson(
    await guest.request("/api/tables/join", {
      method: "POST",
      body: JSON.stringify({ code: created.code }),
    }),
    `${ruleset} join table`,
  );
  summary.checks.push(`${ruleset} table join ok`);

  const hostMineAfterJoin = await expectJson(
    await host.request("/api/tables/mine"),
    `${ruleset} host tables after join`,
  );
  const guestMineAfterJoin = await expectJson(
    await guest.request("/api/tables/mine"),
    `${ruleset} guest tables after join`,
  );

  const started = await expectJson(
    await host.request(`/api/tables/${created.tableId}/start`, {
      method: "POST",
    }),
    `${ruleset} start table`,
  );
  summary.checks.push(`${ruleset} table start ok`);

  const hostMineAfterStart = await expectJson(
    await host.request("/api/tables/mine"),
    `${ruleset} host tables after start`,
  );
  const guestMineAfterStart = await expectJson(
    await guest.request("/api/tables/mine"),
    `${ruleset} guest tables after start`,
  );

  const hostTableAfterStart = findTable(hostMineAfterStart, created.tableId);
  const guestTableAfterStart = findTable(guestMineAfterStart, created.tableId);

  if (hostTableAfterStart.currentGame?.state?.ruleset !== ruleset) {
    throw new Error(
      `${ruleset} host currentGame ruleset mismatch: ${JSON.stringify(hostTableAfterStart.currentGame?.state)}`,
    );
  }
  if (guestTableAfterStart.currentGame?.state?.ruleset !== ruleset) {
    throw new Error(
      `${ruleset} guest currentGame ruleset mismatch: ${JSON.stringify(guestTableAfterStart.currentGame?.state)}`,
    );
  }

  return {
    created,
    joined,
    started,
    hostMineAfterJoin,
    guestMineAfterJoin,
    hostMineAfterStart,
    guestMineAfterStart,
  };
}

async function main() {
  const runId = randomUUID().slice(0, 8);
  const host = new SessionClient("host");
  const guest = new SessionClient("guest");

  const summary = {
    runId,
    health: {},
    users: {},
    scenarios: {},
    checks: [],
  };

  const serverHealthResponse = await fetch(`${serverBaseUrl}/health`);
  summary.health.server = {
    status: serverHealthResponse.status,
    body: await readJson(serverHealthResponse),
  };
  if (serverHealthResponse.status !== 200 || !summary.health.server.body?.ok) {
    throw new Error(`server health failed: ${JSON.stringify(summary.health.server)}`);
  }
  summary.checks.push("server health ok");

  const webResponse = await fetch(webBaseUrl);
  summary.health.web = {
    status: webResponse.status,
    contentType: webResponse.headers.get("content-type"),
  };
  if (!webResponse.ok) {
    throw new Error(`web reachability failed: ${JSON.stringify(summary.health.web)}`);
  }
  summary.checks.push("web reachable");

  const hostEmail = `task14-host-${runId}@example.com`;
  const guestEmail = `task14-guest-${runId}@example.com`;
  const password = "password1234";

  summary.users.host = await expectJson(
    await host.request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        name: `Task14 Host ${runId}`,
        email: hostEmail,
        password,
      }),
    }),
    "host sign up",
  );
  summary.checks.push("host sign up ok");

  summary.users.guest = await expectJson(
    await guest.request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        name: `Task14 Guest ${runId}`,
        email: guestEmail,
        password,
      }),
    }),
    "guest sign up",
  );
  summary.checks.push("guest sign up ok");

  summary.users.hostMineBeforeCreate = await expectJson(
    await host.request("/api/tables/mine"),
    "host tables before create",
  );
  summary.users.guestMineBeforeJoin = await expectJson(
    await guest.request("/api/tables/mine"),
    "guest tables before join",
  );

  summary.scenarios.yatzy = await runScenario({ host, guest, ruleset: "yatzy", summary });
  summary.scenarios.yahtzee = await runScenario({ host, guest, ruleset: "yahtzee", summary });

  console.log(JSON.stringify(summary, null, 2));
}

await main();
