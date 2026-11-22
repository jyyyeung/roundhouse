import type { Json } from "@roundhouse/game-core";
import { Hono } from "hono";
import { z } from "zod";
import { env } from "../env";
import { getModule } from "../modules/registry";
import { TablesError, type TablesRuntime } from "../room/runtime";

type Session = { user?: { emailVerified?: boolean; id: string } } | null;
type GetSession = (headers: Headers) => Promise<Session> | Session;

const createTableBodySchema = z.object({
  gameId: z.string().min(1),
  config: z.unknown().optional(),
  softSeatCap: z.number().int().positive().optional(),
});

const joinBodySchema = z.object({
  code: z.string().min(1),
});

const kickBodySchema = z.object({
  userId: z.string().min(1).max(64),
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

/**
 * Config validation belongs to the game, not to this router: the module that
 * will run the game publishes the schema, and an unknown game id is refused
 * before anything else happens. A caller that sends no config gets the module's
 * default, which is what the catalogue advertises.
 */
function parseCreateTableBody(input: unknown) {
  const body = createTableBodySchema.parse(input);
  let module: ReturnType<typeof getModule>;
  try {
    module = getModule(body.gameId);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("unknown_game:")) {
      throw new TablesError("unknown_game", error.message);
    }
    throw error;
  }
  return {
    gameId: body.gameId,
    softSeatCap: body.softSeatCap,
    config: (body.config === undefined
      ? module.defaultConfig
      : module.configSchema.parse(body.config)) as Json,
  };
}

async function loadSession(
  getSession: (headers: Headers) => Promise<Session> | Session,
  headers: Headers,
) {
  const session = await getSession(headers);
  const userId = session?.user?.id;
  if (!userId) {
    throw new TablesError("not_authenticated", "not_authenticated", 401);
  }
  return { emailVerified: session?.user?.emailVerified === true, userId };
}

async function requireSession(
  getSession: (headers: Headers) => Promise<Session> | Session,
  headers: Headers,
) {
  return (await loadSession(getSession, headers)).userId;
}

/**
 * Browsing needs a session; *playing* needs a proven address, because that is
 * what stops a script from filling tables with throwaway sign-ups. Only create
 * and join ask for it — reading the lobby, chatting from a seat you already hold
 * and leaving are all allowed, so an account that lost its address still has a
 * way to keep playing until an operator looks.
 */
async function requirePlayerSession(
  getSession: (headers: Headers) => Promise<Session> | Session,
  headers: Headers,
  requireVerification: boolean,
) {
  const { emailVerified, userId } = await loadSession(getSession, headers);
  if (requireVerification && !emailVerified) {
    throw new TablesError(
      "needs_verify",
      "verify your email address before creating or joining a table",
      403,
    );
  }
  return userId;
}

export function createTablesRouter(opts: {
  runtime: TablesRuntime;
  getSessionFromHeaders: GetSession;
  /**
   * Start/rematch are HTTP, so the sockets in that room would otherwise keep
   * rendering the pre-mutation state until they resubscribed. The server wires
   * this to the hub's state push.
   */
  onTableChanged?: (tableId: string) => void;
  /**
   * A player's seat can be given up or taken away. The state push above cannot
   * carry that: the person has to be told why and dropped from the room, which
   * is the hub's job (its sockets are keyed by table).
   */
  onSeatRemoved?: (tableId: string, userId: string, reason: "left" | "kicked") => void;
  /**
   * Refuse to create or join without a verified address. Defaults to
   * `AUTH_REQUIRE_VERIFICATION`; a test flips it without touching the process
   * environment.
   */
  requireVerification?: boolean;
}) {
  const runtime = opts.runtime;
  const getSession = opts.getSessionFromHeaders;
  const requireVerification = opts.requireVerification ?? env.AUTH_REQUIRE_VERIFICATION;
  const app = new Hono();

  const handleError = (error: unknown) => {
    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({
          code: "invalid_request",
          message: error.issues[0]?.message ?? "invalid_request",
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }
    const tableError = toTablesError(error);
    if (tableError) {
      return new Response(JSON.stringify({ code: tableError.code, message: tableError.message }), {
        status: tableError.status,
        headers: { "content-type": "application/json" },
      });
    }

    throw error;
  };

  app.post("/", async (c) => {
    try {
      const userId = await requirePlayerSession(getSession, c.req.raw.headers, requireVerification);
      const body = parseCreateTableBody(await c.req.json());
      const result = await runtime.createTable({
        userId,
        gameId: body.gameId,
        config: body.config,
        softSeatCap: body.softSeatCap,
      });
      return c.json(result, 201);
    } catch (error) {
      return handleError(error);
    }
  });

  app.post("/join", async (c) => {
    try {
      const userId = await requirePlayerSession(getSession, c.req.raw.headers, requireVerification);
      const body = joinBodySchema.parse(await c.req.json());
      const result = await runtime.joinTable({ userId, code: body.code });
      // A seat change is a state change: the host's open view has to learn about
      // the new player, or "Start game" stays disabled until someone reloads.
      opts.onTableChanged?.(result.tableId);
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
      opts.onTableChanged?.(id);
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
      opts.onTableChanged?.(id);
      return c.json(result);
    } catch (error) {
      return handleError(error);
    }
  });

  app.post("/:id/leave", async (c) => {
    try {
      const userId = await requireSession(getSession, c.req.raw.headers);
      const { id } = tableIdSchema.parse({ id: c.req.param("id") });
      const result = await runtime.leaveTable({ userId, tableId: id });
      // The survivors need the new seat list; the leaver's own sockets need to be
      // told and dropped, which the state push cannot do.
      if (!result.tableDeleted) opts.onTableChanged?.(id);
      opts.onSeatRemoved?.(id, userId, "left");
      return c.json(result);
    } catch (error) {
      return handleError(error);
    }
  });

  app.post("/:id/kick", async (c) => {
    try {
      const userId = await requireSession(getSession, c.req.raw.headers);
      const { id } = tableIdSchema.parse({ id: c.req.param("id") });
      const body = kickBodySchema.parse(await c.req.json());
      const result = await runtime.kickTablePlayer({
        hostUserId: userId,
        tableId: id,
        targetUserId: body.userId,
      });
      opts.onTableChanged?.(id);
      opts.onSeatRemoved?.(id, body.userId, "kicked");
      return c.json(result);
    } catch (error) {
      return handleError(error);
    }
  });

  app.get("/:id/replay", async (c) => {
    try {
      const userId = await requireSession(getSession, c.req.raw.headers);
      const { id } = tableIdSchema.parse({ id: c.req.param("id") });
      const replay = await runtime.getTableReplay({ asUserId: userId, tableId: id });
      return c.json(replay);
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
