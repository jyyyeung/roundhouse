import type { IncomingMessage } from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type WebSocket, WebSocketServer } from "ws";

import { auth, getSessionFromHeaders } from "./auth";
import { db } from "./db/client";
import { env } from "./env";
import { createTablesRouter } from "./http/tables";
import { createRoomRuntime } from "./room/runtime";
import { createWsHub } from "./ws/hub";

const app = new Hono();
const runtime = createRoomRuntime(db);
const wsHub = createWsHub({ getSessionFromHeaders, runtime });
const wss = new WebSocketServer({ noServer: true });

app.get("/health", (c) => c.json({ ok: true }));

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
  "/api/tables/*",
  cors({
    origin: env.PUBLIC_WEB_URL,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.on(["POST", "GET", "OPTIONS"], "/api/auth/*", (c) => auth.handler(c.req.raw));

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
  }),
);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
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
