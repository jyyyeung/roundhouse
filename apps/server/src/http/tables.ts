import { Hono } from "hono";
import { z } from "zod";

import type { Json } from "@yatzy/game-core";
import { TablesError, type TablesRuntime } from "../room/runtime";

type Session = { user?: { id: string } } | null;
type GetSession = (headers: Headers) => Promise<Session> | Session;

const createTableBodySchema = z.object({
  gameId: z.string().min(1),
  config: z.unknown(),
  softSeatCap: z.number().int().positive().optional(),
});

const joinBodySchema = z.object({
  code: z.string().min(1),
});

const tableIdSchema = z.object({
  id: z.string().min(1),
});

function toTablesError(error: unknown) {
  if (error instanceof TablesError) return error;
  if (error instanceof Error && error.message.startsWith("unknown_game:")) {
    return new TablesError("unknown_game", error.message);
  }
  return null;
}

async function requireSession(getSession: (headers: Headers) => Promise<Session> | Session, headers: Headers) {
  const session = await getSession(headers);
  const userId = session?.user?.id;
  if (!userId) {
    throw new TablesError("not_authenticated", "not_authenticated", 401);
  }
  return userId;
}

export function createTablesRouter(opts: {
  runtime: TablesRuntime;
  getSessionFromHeaders: GetSession;
}) {
  const runtime = opts.runtime;
  const getSession = opts.getSessionFromHeaders;
  const app = new Hono();

  const handleError = (error: unknown) => {
    const tableError = toTablesError(error);
    if (tableError) {
      return new Response(
        JSON.stringify({ code: tableError.code, message: tableError.message }),
        {
          status: tableError.status,
          headers: { "content-type": "application/json" },
        },
      );
    }

    throw error;
  };

  app.post("/", async (c) => {
    try {
      const userId = await requireSession(getSession, c.req.raw.headers);
      const body = createTableBodySchema.parse(await c.req.json());
      const result = await runtime.createTable({
        userId,
        gameId: body.gameId,
        config: body.config as Json,
        softSeatCap: body.softSeatCap,
      });
      return c.json(result, 201);
    } catch (error) {
      return handleError(error);
    }
  });

  app.post("/join", async (c) => {
    try {
      const userId = await requireSession(getSession, c.req.raw.headers);
      const body = joinBodySchema.parse(await c.req.json());
      const result = await runtime.joinTable({ userId, code: body.code });
      return c.json(result);
    } catch (error) {
      return handleError(error);
    }
  });

  app.post("/:id/start", async (c) => {
    try {
      const userId = await requireSession(getSession, c.req.raw.headers);
      const { id } = tableIdSchema.parse({ id: c.req.param("id") });
      const result = await runtime.startTable({ userId, tableId: id });
      return c.json(result);
    } catch (error) {
      return handleError(error);
    }
  });

  app.post("/:id/rematch", async (c) => {
    try {
      const userId = await requireSession(getSession, c.req.raw.headers);
      const { id } = tableIdSchema.parse({ id: c.req.param("id") });
      const result = await runtime.rematchTable({ userId, tableId: id });
      return c.json(result);
    } catch (error) {
      return handleError(error);
    }
  });

  app.get("/mine", async (c) => {
    try {
      const userId = await requireSession(getSession, c.req.raw.headers);
      const result = await runtime.getMine({ userId });
      return c.json(result);
    } catch (error) {
      return handleError(error);
    }
  });

  return app;
}
export { TablesError };
