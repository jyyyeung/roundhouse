import type { ClientMessage, ServerMessage } from "@yatzy/game-core";
import type { IncomingMessage } from "node:http";
import { WebSocket, type RawData } from "ws";

import type { TableSnapshot, TablesRuntime } from "../room/runtime";
import { createWsHandlers } from "./handlers";

type Session = { user?: { id: string } } | null;
type GetSession = (headers: Headers) => Promise<Session> | Session;
type HubSocket = WebSocket & { tableId?: string; userId?: string };

const ACTION_TTL_MS = 5 * 60 * 1000;

export function createWsHub(opts: {
  runtime: TablesRuntime;
  getSessionFromHeaders: GetSession;
}) {
  const actionIdsByTable = new Map<string, Map<string, number>>();
  const socketsByTable = new Map<string, Set<HubSocket>>();
  const userIdsByTable = new Map<string, Set<string>>();

  const handlers = createWsHandlers({
    runtime: opts.runtime,
    isDuplicateAction(tableId, actionId) {
      pruneExpiredActions(tableId);
      return actionIdsByTable.get(tableId)?.has(actionId) ?? false;
    },
    publishToTable,
    rememberAction(tableId, actionId) {
      pruneExpiredActions(tableId);
      let actionIds = actionIdsByTable.get(tableId);
      if (!actionIds) {
        actionIds = new Map<string, number>();
        actionIdsByTable.set(tableId, actionIds);
      }
      actionIds.set(actionId, Date.now() + ACTION_TTL_MS);
    },
  });

  return {
    async handleConnection(ws: WebSocket, request: IncomingMessage) {
      const socket = ws as HubSocket;
      const session = await opts.getSessionFromHeaders(toHeaders(request));
      const userId = session?.user?.id;
      if (!userId) {
        socket.close(4401, "not_authenticated");
        return;
      }

      socket.userId = userId;

      socket.on("message", async (raw: RawData) => {
        try {
          const message = parseClientMessage(raw);
          if (!message) {
            send(socket, {
              code: "bad_message",
              message: "bad_message",
              type: "error",
              v: 1,
            });
            return;
          }

          if (message.type === "subscribe") {
            await subscribe(socket, message.tableId);
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
          send(socket, {
            code: "internal_error",
            message: error instanceof Error ? error.message : "internal_error",
            tableId: socket.tableId,
            type: "error",
            v: 1,
          });
        }
      });

      socket.on("close", () => {
        void unsubscribe(socket);
      });
    },
  };

  async function subscribe(socket: HubSocket, tableId: string) {
    const snapshot = await opts.runtime.getTableSnapshot({ tableId });
    if (!snapshot) {
      send(socket, {
        code: "table_missing",
        message: "table_missing",
        tableId,
        type: "error",
        v: 1,
      });
      return;
    }

    const previousTableId = socket.tableId;
    if (previousTableId && previousTableId !== tableId) {
      removeSocket(previousTableId, socket);
    }

    socket.tableId = tableId;
    addSocket(tableId, socket);
    sendSnapshot(socket, snapshot);

    if (previousTableId && previousTableId !== tableId) {
      await publishPresence(previousTableId);
    }
    await publishPresence(tableId);
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

    let userIds = userIdsByTable.get(tableId);
    if (!userIds) {
      userIds = new Set<string>();
      userIdsByTable.set(tableId, userIds);
    }
    if (socket.userId) {
      userIds.add(socket.userId);
    }
  }

  function removeSocket(tableId: string, socket: HubSocket) {
    const sockets = socketsByTable.get(tableId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        socketsByTable.delete(tableId);
      }
    }

    if (socket.userId) {
      const userIds = new Set<string>();
      for (const currentSocket of socketsByTable.get(tableId) ?? []) {
        if (currentSocket.userId) {
          userIds.add(currentSocket.userId);
        }
      }
      if (userIds.size === 0) {
        userIdsByTable.delete(tableId);
      } else {
        userIdsByTable.set(tableId, userIds);
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

  function publishPresence(tableId: string) {
    publishToTable(tableId, {
      onlineUserIds: [...(userIdsByTable.get(tableId) ?? [])].sort(),
      tableId,
      type: "presence",
      v: 1,
    });
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

function sendSnapshot(socket: WebSocket, snapshot: TableSnapshot) {
  send(socket, {
    meta: snapshot.meta,
    seq: snapshot.seq,
    state: snapshot.state,
    tableId: snapshot.tableId,
    type: "snapshot",
    v: 1,
  });
}

function parseClientMessage(raw: RawData): ClientMessage | null {
  try {
    return JSON.parse(rawToString(raw)) as ClientMessage;
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
