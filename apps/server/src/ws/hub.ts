import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type {
  EventEnvelope,
  Json,
  RawGameState,
  ServerMessage,
  TableMeta,
} from "@roundhouse/game-core";
import { PROTOCOL_VERSION, parseClientMessage } from "@roundhouse/game-core";
import { type RawData, WebSocket } from "ws";
import { db } from "../db/client";
import { createLogger, type Logger } from "../log";
import { getModule } from "../modules/registry";
import { projectSnapshot, viewerForUser } from "../room/projection";
import type { TableSnapshot, TablesRuntime } from "../room/runtime";
import { createWsHandlers } from "./handlers";
import { type ChatPage, listChatMessagesForTable, persistChatMessageToDb } from "./persistence";
import type { Limiter } from "./rate-limit";

type Session = { user?: { id: string } } | null;
type GetSession = (headers: Headers) => Promise<Session> | Session;
type HubSocket = WebSocket & {
  connectionId: string;
  tableId?: string;
  userId?: string;
  /** Holds no seat: admitted to watch a public table, never to play it. */
  spectating?: boolean;
};

const ACTION_TTL_MS = 5 * 60 * 1000;
// A yatzy intent or chat message is a few hundred bytes; 64 KiB is generous and
// still small enough that a hostile frame costs one Buffer.byteLength call.
const MAX_FRAME_BYTES = 64 * 1024;

export function createWsHub(opts: {
  runtime: TablesRuntime;
  getSessionFromHeaders: GetSession;
  /** Chat paging is read-only and side-effect free, so tests inject it. */
  listChatPage?: (input: { tableId: string; beforeId?: string }) => Promise<ChatPage>;
  /** Structured logger; tests inject a capturing one. */
  logger?: Logger;
  /**
   * Abuse budgets; production leaves these at their env defaults. A test that
   * sends fifty intents in a millisecond is exercising frame fan-out, not the
   * limiter, so it injects its own.
   */
  limits?: { intent?: Limiter; chat?: Limiter };
}) {
  const log = opts.logger ?? createLogger({ fields: { component: "ws.hub" } });
  const listChatPage =
    opts.listChatPage ??
    ((input) => listChatMessagesForTable(db, input.tableId, { beforeId: input.beforeId }));

  const actionIdsByTable = new Map<string, Map<string, number>>();
  const socketsByTable = new Map<string, Set<HubSocket>>();
  // Last presence roster broadcast per table, so a socket joining an already
  // online roster does not make every other socket re-render the same list.
  const presenceByTable = new Map<string, string>();

  // wire persistence hooks (real DB)
  const persistence = {
    persistChatMessage: (input: {
      tableId: string;
      userId: string;
      text: string;
      snapshot: Json;
      createdAt: Date;
    }) => persistChatMessageToDb(db, input),
  };

  const handlers = createWsHandlers({
    limits: opts.limits,
    logger: log,
    runtime: opts.runtime,
    publishToTable,
    publishApplied,
    isDuplicateAction(tableId, actionId) {
      pruneExpiredActions(tableId);
      return actionIdsByTable.get(tableId)?.has(actionId) ?? false;
    },
    ...persistence,
    rememberAction(tableId, actionId) {
      pruneExpiredActions(tableId);
      let actionIds = actionIdsByTable.get(tableId);
      if (!actionIds) {
        actionIds = new Map<string, number>();
        actionIdsByTable.set(tableId, actionIds);
      }
      actionIds.set(actionId, Date.now() + ACTION_TTL_MS);
    },
    forgetAction(tableId, actionId) {
      const actionIds = actionIdsByTable.get(tableId);
      if (!actionIds) return;
      actionIds.delete(actionId);
      if (actionIds.size === 0) {
        actionIdsByTable.delete(tableId);
      }
    },
  });

  return {
    /** Called after an HTTP mutation so sockets see the new state immediately. */
    publishTableState,
    /**
     * Drops one player's sockets out of a table room, telling them why.
     *
     * A seat can be given up or taken away; either way that person must stop
     * receiving this table's frames and be refused if it reconnects. The refusal
     * needs no new state: `subscribe` checks the seat list, which no longer
     * contains them. Closing the socket is what makes a dropped client stop
     * waiting for frames it will never get.
     */
    async evictFromTable(tableId: string, userId: string, reason: "left" | "kicked") {
      const sockets = socketsByTable.get(tableId);
      if (!sockets) return;

      const code = reason === "kicked" ? "kicked" : "seat_left";
      for (const socket of [...sockets]) {
        if (socket.userId !== userId) continue;
        sendError(socket, code, code, tableId);
        await unsubscribe(socket);
        socket.close(4403, code);
      }
    },
    /**
     * Close every live socket with a retryable code (1012 = service restart) so a
     * client reconnects to the fresh process instead of treating the disconnect as
     * a failure worth backing off from.
     */
    shutdown({ code = 1012, reason = "server_restart" }: { code?: number; reason?: string } = {}) {
      let closed = 0;
      for (const sockets of socketsByTable.values()) {
        for (const socket of sockets) {
          socket.close(code, reason);
          closed += 1;
        }
      }
      socketsByTable.clear();
      presenceByTable.clear();
      actionIdsByTable.clear();
      log.info("ws.shutdown", { closed, code, reason });
      return closed;
    },
    async handleConnection(ws: WebSocket, request: IncomingMessage) {
      const socket = ws as HubSocket;
      socket.connectionId = randomUUID();
      log.debug("ws.connected", { connectionId: socket.connectionId });
      // Register listeners before awaiting auth — clients send subscribe on open and
      // those frames are dropped if the handler isn't attached yet.
      const pending: RawData[] = [];
      let ready = false;
      let userId: string | undefined;

      async function handleRaw(raw: RawData) {
        if (!userId) {
          send(socket, {
            code: "not_authenticated",
            message: "not_authenticated",
            type: "error",
            v: PROTOCOL_VERSION,
          });
          return;
        }

        const text = rawToString(raw);
        const bytes = Buffer.byteLength(text);
        if (bytes > MAX_FRAME_BYTES) {
          // Refuse oversized frames before parsing them: a 10 MB chat payload should
          // cost one comparison, not a JSON parse. 1009 is "message too big".
          send(socket, {
            code: "frame_too_large",
            message: `frame_too_large:${bytes}`,
            type: "error",
            v: PROTOCOL_VERSION,
          });
          log.warn("ws.frame_too_large", {
            bytes,
            connectionId: socket.connectionId,
            tableId: socket.tableId,
          });
          socket.close(1009, "frame_too_large");
          return;
        }

        try {
          const parsed = parseClientMessage(text);
          if (!parsed.ok) {
            send(socket, {
              code: parsed.code,
              message: parsed.detail,
              type: "error",
              v: PROTOCOL_VERSION,
            });
            log.warn("ws.bad_message", {
              code: parsed.code,
              connectionId: socket.connectionId,
              tableId: socket.tableId,
            });
            return;
          }
          const message = parsed.message;

          if (message.type === "subscribe") {
            await subscribe(socket, message.tableId, message.sinceSeq);
            return;
          }

          if (message.type === "sync") {
            await syncTable(socket, message.tableId, message.sinceSeq);
            return;
          }

          if (message.type === "chatPage") {
            await sendChatPage(socket, message.tableId, message.beforeId);
            return;
          }

          await handlers.onMessage(
            {
              get tableId() {
                return socket.tableId;
              },
              set tableId(value) {
                socket.tableId = value;
              },
              send(message) {
                send(socket, message);
              },
              userId,
            },
            message,
          );
        } catch (error) {
          log.error("ws.message_failed", {
            connectionId: socket.connectionId,
            error,
            tableId: socket.tableId,
          });
          send(socket, {
            code: "internal_error",
            message: error instanceof Error ? error.message : "internal_error",
            tableId: socket.tableId,
            type: "error",
            v: PROTOCOL_VERSION,
          });
        }
      }

      socket.on("message", (raw: RawData) => {
        if (!ready) {
          pending.push(raw);
          return;
        }
        void handleRaw(raw);
      });

      socket.on("close", (code: number, reason: Buffer) => {
        log.debug("ws.closed", {
          code,
          connectionId: socket.connectionId,
          reason: reason.toString(),
          tableId: socket.tableId,
        });
        void unsubscribe(socket);
      });

      const session = await opts.getSessionFromHeaders(toHeaders(request));
      userId = session?.user?.id;
      if (!userId) {
        log.warn("ws.not_authenticated", { connectionId: socket.connectionId });
        // Say why before closing: a browser WebSocket cannot read the close reason,
        // only the listener on the page can see the frame.
        send(socket, {
          code: "not_authenticated",
          message: "not_authenticated",
          type: "error",
          v: PROTOCOL_VERSION,
        });
        socket.close(4401, "not_authenticated");
        return;
      }

      socket.userId = userId;
      ready = true;
      for (const raw of pending) {
        await handleRaw(raw);
      }
    },
  };

  /**
   * Attaches the socket to a table and answers with authoritative state.
   *
   * A reconnect can pass `sinceSeq` to replay only what it missed; the chat page
   * is asked for separately by the client, so a resubscribe never drags history
   * with it.
   */
  async function subscribe(socket: HubSocket, tableId: string, sinceSeq?: number) {
    const snapshot = await opts.runtime.getTableSnapshot({
      asUserId: socket.userId ?? null,
      tableId,
    });
    if (!snapshot) {
      sendError(socket, "table_missing", "table_missing", tableId);
      return;
    }
    const userId = socket.userId;
    if (!userId) {
      sendError(socket, "not_seated", "not_seated", tableId);
      return;
    }
    // A seat is the only way in unless the host opened the table to watchers
    // (M2-1, #56). Either way the socket subscribes to the same room and is
    // projected on its own: a spectator's frames carry `you: null`.
    const seated = snapshot.meta.seatUserIds.includes(userId);
    if (!seated && !snapshot.meta.spectatorsAllowed) {
      sendError(socket, "not_seated", "not_seated", tableId);
      return;
    }
    socket.spectating = !seated;

    const previousTableId = socket.tableId;
    if (previousTableId && previousTableId !== tableId) {
      removeSocket(previousTableId, socket);
    }

    socket.tableId = tableId;
    addSocket(tableId, socket);

    if (sinceSeq !== undefined) {
      await sendSyncFrame(socket, tableId, sinceSeq);
    } else {
      sendSnapshot(socket, snapshot);
    }

    if (previousTableId && previousTableId !== tableId) {
      await publishPresence(previousTableId);
    }
    // Broadcast only on a real change; a socket (re)joining this table still
    // learns the roster, but nobody else is told the same roster twice.
    await publishPresence(tableId, { only: socket });
  }

  /**
   * Gap repair: replay the missed events when the log covers them, else send a
   * snapshot. Both answers carry state, so the client ends up correct either way.
   */
  async function syncTable(socket: HubSocket, tableId: string, sinceSeq: number) {
    if (socket.tableId !== tableId) {
      // A sync for a table this socket never subscribed to is a fresh subscribe
      // with a stale seq: treat it as one rather than erroring the client out.
      await subscribe(socket, tableId, sinceSeq);
      return;
    }
    await sendSyncFrame(socket, tableId, sinceSeq);
  }

  async function sendSyncFrame(socket: HubSocket, tableId: string, sinceSeq: number) {
    const result = await opts.runtime.getTableSync({
      asUserId: socket.userId ?? null,
      sinceSeq,
      tableId,
    });
    if (!result) {
      sendError(socket, "table_missing", "table_missing", tableId);
      return;
    }

    if (result.kind === "snapshot") {
      sendSnapshot(socket, result);
      return;
    }

    send(socket, {
      events: result.events,
      fromSeq: result.fromSeq,
      meta: result.meta,
      state: result.state,
      tableId,
      toSeq: result.toSeq,
      type: "events",
      v: PROTOCOL_VERSION,
    });
  }

  /** One bounded page of chat, newest-first page by default, older by cursor. */
  async function sendChatPage(socket: HubSocket, tableId: string, beforeId?: string) {
    // Seating was established by `subscribe`, which is what set `socket.tableId`,
    // so no second database round-trip is needed to authorise a read.
    if (socket.tableId !== tableId) {
      sendError(socket, "not_subscribed", "not_subscribed", tableId);
      return;
    }

    const page = await listChatPage({ beforeId, tableId });
    send(socket, {
      hasMore: page.hasMore,
      messages: page.messages,
      tableId,
      type: "chatPage",
      v: PROTOCOL_VERSION,
    });
  }
  async function unsubscribe(socket: HubSocket) {
    const tableId = socket.tableId;
    if (!tableId) return;
    removeSocket(tableId, socket);
    socket.tableId = undefined;
    await publishPresence(tableId);
  }

  function addSocket(tableId: string, socket: HubSocket) {
    let sockets = socketsByTable.get(tableId);
    if (!sockets) {
      sockets = new Set<HubSocket>();
      socketsByTable.set(tableId, sockets);
    }
    sockets.add(socket);
  }

  function removeSocket(tableId: string, socket: HubSocket) {
    const sockets = socketsByTable.get(tableId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        socketsByTable.delete(tableId);
      }
    }
  }

  function publishToTable(tableId: string, message: ServerMessage) {
    const sockets = socketsByTable.get(tableId);
    if (!sockets) return;
    for (const socket of sockets) {
      send(socket, message);
    }
  }

  /**
   * Fan one applied intent out to the table, projected separately for every
   * socket. This is the only place game state becomes an `applied` frame, so a
   * viewer only ever receives what its own projection allows, and every client
   * gets authoritative state for the seq it just advanced to.
   */
  function publishApplied(
    tableId: string,
    input: { seq: number; state: RawGameState; meta: TableMeta; events: EventEnvelope[] },
  ) {
    const sockets = socketsByTable.get(tableId);
    if (!sockets) return;

    const module = moduleOrNull(input.meta.gameId);
    if (!module) return;

    for (const socket of sockets) {
      const viewer = viewerForUser(input.meta.seatUserIds, socket.userId ?? null);
      send(socket, {
        events: input.events,
        meta: input.meta,
        seq: input.seq,
        state: projectSnapshot(module, input.state, viewer),
        tableId,
        type: "applied",
        v: PROTOCOL_VERSION,
      });
    }
  }

  /**
   * Push a fresh snapshot after a mutation that did not come over the socket
   * (start/rematch are HTTP). Without this, everyone but the host would keep
   * rendering the finished game until they reloaded.
   */
  async function publishTableState(tableId: string) {
    const live = await opts.runtime.getTableLiveState({ tableId });
    if (!live) return;

    const sockets = socketsByTable.get(tableId);
    if (!sockets) return;

    const module = live.state === null ? null : moduleOrNull(live.meta.gameId);
    for (const socket of sockets) {
      const viewer = viewerForUser(live.meta.seatUserIds, socket.userId ?? null);
      send(socket, {
        meta: live.meta,
        seq: live.seq,
        state: live.state === null || !module ? null : projectSnapshot(module, live.state, viewer),
        tableId,
        type: "snapshot",
        v: PROTOCOL_VERSION,
      });
    }
  }
  /**
   * Presence follows membership changes, not traffic: a socket joining a table
   * whose roster it is already part of gets the roster itself, but the table is
   * not told the same list again.
   */
  function publishPresence(tableId: string, options: { only?: HubSocket } = {}) {
    const roster = presenceRoster(tableId);
    const frame: ServerMessage = {
      onlineUserIds: roster.onlineUserIds,
      spectatorUserIds: roster.spectatorUserIds,
      tableId,
      type: "presence",
      v: PROTOCOL_VERSION,
    };
    const key = presenceKey(roster.onlineUserIds, roster.spectatorUserIds);

    if (presenceByTable.get(tableId) !== key) {
      presenceByTable.set(tableId, key);
      publishToTable(tableId, frame);
      return;
    }

    if (options.only) send(options.only, frame);
  }

  /**
   * Who is at the table right now, derived from the sockets rather than tracked
   * beside them: one source cannot disagree with itself. A person with any
   * seated socket is a player, however many tabs they opened.
   */
  function presenceRoster(tableId: string) {
    const players = new Set<string>();
    const spectators = new Set<string>();
    for (const socket of socketsByTable.get(tableId) ?? []) {
      if (!socket.userId) continue;
      if (socket.spectating) {
        spectators.add(socket.userId);
      } else {
        players.add(socket.userId);
      }
    }
    for (const userId of players) spectators.delete(userId);
    return { onlineUserIds: [...players].sort(), spectatorUserIds: [...spectators].sort() };
  }

  function pruneExpiredActions(tableId: string) {
    const actionIds = actionIdsByTable.get(tableId);
    if (!actionIds) return;

    const now = Date.now();
    for (const [actionId, expiresAt] of actionIds) {
      if (expiresAt <= now) {
        actionIds.delete(actionId);
      }
    }

    if (actionIds.size === 0) {
      actionIdsByTable.delete(tableId);
    }
  }
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, code: string, message: string, tableId?: string) {
  send(socket, {
    code,
    message,
    ...(tableId === undefined ? {} : { tableId }),
    type: "error",
    v: PROTOCOL_VERSION,
  });
}

/** Stable identity for a presence roster, so an unchanged set compares equal. */
function presenceKey(onlineUserIds: string[], spectatorUserIds: string[]) {
  // The two lists are separated so ["a","b"] + [] never compares equal to
  // ["a"] + ["b"].
  return `${onlineUserIds.join("\u0000")}\u0001${spectatorUserIds.join("\u0000")}`;
}

function sendSnapshot(socket: WebSocket, snapshot: TableSnapshot) {
  send(socket, {
    meta: snapshot.meta,
    seq: snapshot.seq,
    state: snapshot.state,
    tableId: snapshot.tableId,
    type: "snapshot",
    v: PROTOCOL_VERSION,
  });
}

function moduleOrNull(gameId: string) {
  try {
    return getModule(gameId);
  } catch {
    return null;
  }
}

function rawToString(raw: RawData) {
  if (typeof raw === "string") return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return raw.toString("utf8");
}

function toHeaders(request: IncomingMessage) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }
    if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}
