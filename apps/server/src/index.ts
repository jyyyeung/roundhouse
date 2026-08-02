import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";

import { auth } from "./auth";
import { env } from "./env";

const app = new Hono();

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

app.on(["POST", "GET", "OPTIONS"], "/api/auth/*", (c) =>
  auth.handler(c.req.raw),
);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
