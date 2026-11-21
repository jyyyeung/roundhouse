import type {
  ClientTableMessage,
  EventEnvelope,
  RawGameState,
  ServerMessage,
  TableMeta,
} from "@roundhouse/game-core";
import { intentFromClientMessage, PROTOCOL_VERSION } from "@roundhouse/game-core";

import type { TablesRuntime } from "../room/runtime";
import { toChatWire } from "./persistence";


export type WsRuntime = Pick<TablesRuntime, "applyGameIntent" | "getTableSnapshot">;

export type WsConnection = {
  userId: string;
  tableId?: string;
  send: (message: ServerMessage) => void;
};

export function createWsHandlers(deps: {
  runtime: WsRuntime;
  publishToTable: (tableId: string, message: ServerMessage) => void;
  /**
   * Broadcasts projection-safe game state. The hub fans this out per socket,
   * projecting for each viewer; handlers never build a state frame themselves.
   */
  publishApplied: (
    tableId: string,
    input: { seq: number; state: RawGameState; meta: TableMeta; events: EventEnvelope[] },
  ) => void;
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
}) {
  const { isDuplicateAction, publishApplied, publishToTable, rememberAction, forgetAction, runtime } = deps;

  // rate limit state: tableId -> userId -> timestamps (ms)
  const rateLimits = new Map<string, Map<string, number[]>>();

  return {
    async onMessage(connection: WsConnection, message: ClientTableMessage) {
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

        // Successful apply keeps the reservation (TTL managed by hub). Every applied
        // intent is broadcast with its authoritative state: a client renders the
        // state it is given and never reconstructs one from events.
        publishApplied(message.tableId, result);
        return;
      }

      if (message.type === "chat") {
        const actionId = message.actionId;
        const tableId = message.tableId;
        const userId = connection.userId;
        // The chat snapshot is shared by every reader, so it is projected for no
        // particular viewer rather than for the author.
        const snapshot = await runtime.getTableSnapshot({ asUserId: null, tableId });

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
        // 500 chars keeps a single message readable on a phone-sized chat panel.
        const text = message.text.slice(0, 500);

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


        // One frame, every socket. The author's own socket is included so a
        // second tab of the same user stays consistent; the client merges by
        // message id, so nothing is rendered twice.
        publishToTable(tableId, {
          message: toChatWire({
            createdAt,
            id: chatMessageId ?? crypto.randomUUID(),
            snapshot: storedSnapshot,
            text,
            userId,
          }),
          tableId,
          type: "chat",
          v: PROTOCOL_VERSION,
        });

        return;
      }

      // Both table-scoped frame kinds are handled above. Typing the parameter as
      // ClientTableMessage makes this a compile-time exhaustiveness check, so a new
      // client frame type cannot reach the handlers and be silently ignored.
      const unhandled: never = message;
      throw new Error(`unhandled client message: ${JSON.stringify(unhandled)}`);
    },
  };
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
    v: PROTOCOL_VERSION,
  };
}
