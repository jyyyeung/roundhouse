import { intentFromClientMessage, type ClientMessage, type ServerMessage } from "@roundhouse/game-core";

import type { ApplyGameIntentResult, TablesRuntime } from "../room/runtime";

export type WsRuntime = Pick<TablesRuntime, "applyGameIntent" | "getTableSnapshot">;

export type WsConnection = {
  userId: string;
  tableId?: string;
  send: (message: ServerMessage) => void;
};

export function createWsHandlers(deps: {
  runtime: WsRuntime;
  publishToTable: (tableId: string, message: ServerMessage) => void;
  isDuplicateAction: (tableId: string, actionId: string) => boolean;
  rememberAction: (tableId: string, actionId: string) => void;
  forgetAction: (tableId: string, actionId: string) => void;
  // optional persistence hooks
  persistChatMessage?: (input: {
    tableId: string;
    userId: string;
    text: string;
    snapshot: unknown;
    createdAt: Date;
  }) => Promise<{ id: string; createdAt: string }>;
  appendGameEvent?: (input: {
    tableId: string;
    gameId?: string;
    payload: unknown;
    actorId: string;
    createdAt: Date;
  }) => Promise<{ id: string }>;
}) {
  const { isDuplicateAction, publishToTable, rememberAction, forgetAction, runtime } = deps;

  // rate limit state: tableId -> userId -> timestamps (ms)
  const rateLimits = new Map<string, Map<string, number[]>>();

  return {
    async onMessage(connection: WsConnection, message: any) {
      if (message.type === "intent") {
        if (isDuplicateAction(message.tableId, message.actionId)) {
          return;
        }

        // Reserve the actionId immediately to avoid races where two identical
        // intents are applied concurrently.
        rememberAction(message.tableId, message.actionId);

        const result = await runtime.applyGameIntent({
          intent: intentFromClientMessage(message),
          tableId: message.tableId,
          userId: connection.userId,
        });

        if (!result.ok) {
          // Release the reservation on every failure path so a client retry is not
          // silently dropped for ACTION_TTL_MS. Successful applies keep it (dedupe).
          forgetAction(message.tableId, message.actionId);

          connection.send(
            errorMessage({
              actionId: message.actionId,
              code: result.code,
              message: result.message,
              tableId: message.tableId,
            }),
          );
          return;
        }

        // Successful apply keeps the reservation (TTL managed by hub).
        broadcastEvents(message.tableId, result, publishToTable);
        if (result.finished) {
          publishToTable(message.tableId, {
            meta: result.meta,
            seq: result.seq,
            state: result.state,
            tableId: message.tableId,
            type: "snapshot",
            v: 1,
          });
        }
        return;
      }

      if (message.type === "chat") {
        const actionId = message.actionId;
        const tableId = message.tableId!;
        const userId = connection.userId;
        const snapshot = await runtime.getTableSnapshot({ tableId });

        if (!snapshot) {
          connection.send(
            errorMessage({
              actionId,
              code: "table_missing",
              message: "table_missing",
              tableId,
            }),
          );
          return;
        }

        if (!snapshot.meta.seatUserIds.includes(userId)) {
          connection.send(
            errorMessage({
              actionId,
              code: "not_seated",
              message: "not_seated",
              tableId,
            }),
          );
          return;
        }

        // rate-limit: ~5 msg / 10s / user / table
        const now = Date.now();
        const windowMs = 10_000;
        const maxMsgs = 5;
        let tableMap = rateLimits.get(tableId);
        if (!tableMap) {
          tableMap = new Map();
          rateLimits.set(tableId, tableMap);
        }
        const userTimestamps = tableMap.get(userId) ?? [];
        const recent = userTimestamps.filter((t) => now - t <= windowMs);
        if (recent.length >= maxMsgs) {
          connection.send(
            errorMessage({
              actionId,
              code: "rate_limited",
              message: "rate_limited",
              tableId,
            }),
          );
          return;
        }
        recent.push(now);
        tableMap.set(userId, recent);

        // truncate text to 500 chars
        const rawText =
          typeof message.text === "string"
            ? message.text
            : (message.payload && (message.payload as { text?: unknown }).text) || "";
        const text = String(rawText).slice(0, 500);

        const storedSnapshot = {
          tableId: snapshot.tableId,
          seq: snapshot.seq,
          state: snapshot.state,
          meta: snapshot.meta,
        };

        // persist chat_message if hook provided
        const createdAt = new Date();
        let chatMessageId: string | undefined;
        if (typeof deps.persistChatMessage === "function") {
          try {
            const res = await deps.persistChatMessage({
              tableId,
              userId,
              text,
              snapshot: storedSnapshot,
              createdAt,
            });
            chatMessageId = res.id;
          } catch {
            // swallow persist errors for now
          }
        }

        // if a game row exists (we have server state), append game_event chat_sent if hook available
        if (snapshot.state != null && typeof deps.appendGameEvent === "function") {
          try {
            await deps.appendGameEvent({
              tableId,
              gameId: snapshot.meta.gameId,
              payload: { chatMessageId, text },
              actorId: userId,
              createdAt,
            });
          } catch {
            // ignore
          }
        }

        // broadcast chat ServerMessage
        publishToTable(tableId, {
          type: "chat",
          v: 1,
          tableId,
          message: {
            id: chatMessageId ?? crypto.randomUUID(),
            userId,
            text,
            snapshot: storedSnapshot,
            createdAt: createdAt.toISOString(),
          },
        });

        return;
      }

      const actionId = message.type === "chat" ? message.actionId : undefined;
      connection.send(
        errorMessage({
          actionId,
          code: "unsupported_message",
          message: "unsupported_message",
          tableId: message.tableId,
        }),
      );
    },
  };
}

function broadcastEvents(
  tableId: string,
  result: Extract<ApplyGameIntentResult, { ok: true }>,
  publishToTable: (tableId: string, message: ServerMessage) => void,
) {
  for (const event of result.events) {
    publishToTable(tableId, {
      event,
      tableId,
      type: "event",
      v: 1,
    });
  }
}

function errorMessage(input: {
  code: string;
  message: string;
  tableId?: string;
  actionId?: string;
}): ServerMessage {
  return {
    actionId: input.actionId,
    code: input.code,
    message: input.message,
    tableId: input.tableId,
    type: "error",
    v: 1,
  };
}
