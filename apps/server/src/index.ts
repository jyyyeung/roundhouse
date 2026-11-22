import { randomUUID } from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { serve } from "@hono/node-server";
import { PROTOCOL_VERSION } from "@roundhouse/game-core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type WebSocket, WebSocketServer } from "ws";

import { auth, getSessionFromHeaders } from "./auth";
import { closeDatabase, db } from "./db/client";
import { runMigrations } from "./db/migrate";
import { env } from "./env";
import { createGamesRouter } from "./http/games";
import { createTablesRouter } from "./http/tables";
import { logger } from "./log";
import { createDatabaseChecks } from "./ops/db-health";
import { createLivenessHandler, createReadinessHandler } from "./ops/probes";
import { createGracefulShutdown } from "./ops/shutdown";
import { createRoomRuntime } from "./room/runtime";
import { createWsHub } from "./ws/hub";

const app = new Hono();
const runtime = createRoomRuntime(db);
const wsHub = createWsHub({ getSessionFromHeaders, logger, runtime });
const wss = new WebSocketServer({ noServer: true });

app.use("*", async (c, next) => {
  // A per-request id lets one browser action be followed through the HTTP log and
  // the socket log that answers it.
  const requestId = c.req.header("x-request-id") ?? randomUUID();
  c.header("x-request-id", requestId);
  const startedAt = Date.now();
  await next();
  logger.debug("http.request", {
    durationMs: Date.now() - startedAt,
    method: c.req.method,
    path: c.req.path,
    requestId,
    status: c.res.status,
  });
});

// Liveness is I/O free on purpose: restarting a process because Postgres is down
// makes an outage worse. `/ready` is the probe that checks dependencies.
app.get("/health", createLivenessHandler());
app.get(
  "/ready",
  createReadinessHandler({
    checks: createDatabaseChecks({ db, logger }),
    logger,
  }),
);

app.use(
  "/api/auth/*",
  cors({
    origin: env.PUBLIC_WEB_URL,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.use(
  "/api/games/*",
  cors({
    origin: env.PUBLIC_WEB_URL,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "OPTIONS"],
  }),
);

app.use(
  "/api/tables/*",
  cors({
    origin: env.PUBLIC_WEB_URL,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.on(["POST", "GET", "OPTIONS"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/games", createGamesRouter());

app.route(
  "/api/tables",
  createTablesRouter({
    runtime,
    getSessionFromHeaders,
    onTableChanged: (tableId) => {
      // Fire and forget: the HTTP response must not wait on socket fan-out, and a
      // failed push is repaired by the client's next `sync`.
      void wsHub.publishTableState(tableId);
    },
    onSeatRemoved: (tableId, userId, reason) => {
      // The evicted player is not in the room `publishTableState` addresses, so
      // the hub has to be told directly who lost a seat and why.
      void wsHub.evictFromTable(tableId, userId, reason);
    },
  }),
);

// Migrations run before the listener opens, so a fresh database is never served
// a request against a schema it does not have. A failure is logged and startup
// continues: `/ready` reports it instead of the container exiting in a loop.
try {
  await runMigrations(db, logger);
} catch (error) {
  logger.error("migrate.failed", { error });
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info("server.listening", { port: info.port, version: PROTOCOL_VERSION });
});

wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
  void wsHub.handleConnection(ws, request);
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
    wss.emit("connection", ws, request);
  });
});

/**
 * Shutdown order matters: tell websocket clients the restart is intentional,
 * then stop accepting connections, then release the pool. Sockets have to go
 * first — an open websocket keeps the HTTP server's close callback pending, so
 * the whole budget would be spent waiting for it and clients would see an
 * abnormal 1006 close instead of a reason they can act on.
 *
 * Each step is bounded, and the whole sequence is bounded again, so a wedged
 * dependency cannot hang the deploy.
 */
const shutdown = createGracefulShutdown({
  logger,
  steps: [
    {
      name: "ws",
      close: () => {
        wsHub.shutdown();
      },
    },
    {
      name: "http",
      close: () =>
        new Promise<void>((resolve) => {
          const http = server as unknown as HttpServer;
          http.close(() => resolve());
          // Idle keep-alive sockets would otherwise hold the close callback
          // open; anything still mid-request gets two seconds, then the
          // fallback cuts it so the pool can be released.
          http.closeIdleConnections?.();
          const timer = setTimeout(() => {
            http.closeAllConnections?.();
            resolve();
          }, 2000);
          timer.unref?.();
        }),
    },
    {
      name: "db",
      close: () => closeDatabase(),
    },
  ],
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown.shutdown(signal);
  });
}

process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled_rejection", { error: reason });
});

process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", { error });
  void shutdown.shutdown("uncaughtException");
});
