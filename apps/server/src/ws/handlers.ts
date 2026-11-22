import type {
  ClientTableMessage,
  EventEnvelope,
  Json,
  RawGameState,
  ServerMessage,
  TableMeta,
} from "@roundhouse/game-core";
import { intentFromClientMessage, PROTOCOL_VERSION } from "@roundhouse/game-core";

import { env } from "../env";
import { createLogger, type Logger } from "../log";
import type { TablesRuntime } from "../room/runtime";
import { toChatWire } from "./persistence";
import { createLimiter, type Limiter } from "./rate-limit";

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
  /** Structured logger; the hub injects one so lines share its connection fields. */
  logger?: Logger;
  // optional persistence hooks
  persistChatMessage?: (input: {
    tableId: string;
    userId: string;
    text: string;
    snapshot: Json;
    createdAt: Date;
  }) => Promise<{ id: string; createdAt: string }>;
  /**
   * Budgets are injectable so tests can drive them from an injected clock, and so
   * a future caller (a relay, a bot) can be given a different allowance.
   */
  limits?: { intent?: Limiter; chat?: Limiter };
}) {
  const {
    isDuplicateAction,
    publishApplied,
    publishToTable,
    rememberAction,
    forgetAction,
    runtime,
  } = deps;
  const log = deps.logger ?? createLogger({ fields: { component: "ws.handlers" } });

  // Two inputs a client can drive in a loop, one limiter type. The defaults come
  // from the environment so a deployment can tighten them without a rebuild;
  // chat keeps its historical 5 messages per 10s.
  const intentLimiter =
    deps.limits?.intent ??
    createLimiter({ limit: env.INTENT_RATE_LIMIT, windowMs: env.INTENT_RATE_WINDOW_MS });
  const chatLimiter =
    deps.limits?.chat ??
    createLimiter({ limit: env.CHAT_RATE_LIMIT, windowMs: env.CHAT_RATE_WINDOW_MS });

  return {
    async onMessage(connection: WsConnection, message: ClientTableMessage) {
      if (message.type === "intent") {
        if (isDuplicateAction(message.tableId, message.actionId)) {
          return;
        }
        // The budget is spent before the actionId is reserved. A refused intent
        // must not mark its id as applied, or the retry after the window would be
        // dropped as a duplicate and the move silently lost.
        const budget = intentLimiter.take(`${message.tableId}:${connection.userId}`);
        if (!budget.ok) {
          connection.send(
            errorMessage({
              actionId: message.actionId,
              code: "rate_limited",
              message: "rate_limited",
              retryAfterMs: budget.retryAfterMs,
              tableId: message.tableId,
            }),
          );
          log.warn("ws.intent_rate_limited", {
            actionId: message.actionId,
            intentType: message.intentType,
            retryAfterMs: budget.retryAfterMs,
            tableId: message.tableId,
            userId: connection.userId,
          });
          return;
        }

        // Reserve the actionId immediately to avoid races where two identical
        // intents are applied concurrently.
        rememberAction(message.tableId, message.actionId);

        const startedAt = Date.now();
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
        log.debug("ws.intent_applied", {
          actionId: message.actionId,
          durationMs: Date.now() - startedAt,
          intentType: message.intentType,
          seq: result.seq,
          tableId: message.tableId,
          userId: connection.userId,
        });
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

        // Chat budget: the same limiter, keyed per table and user.
        const chatBudget = chatLimiter.take(`${tableId}:${userId}`);
        if (!chatBudget.ok) {
          connection.send(
            errorMessage({
              actionId,
              code: "rate_limited",
              message: "rate_limited",
              retryAfterMs: chatBudget.retryAfterMs,
              tableId,
            }),
          );
          return;
        }
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
          } catch (error) {
            // History is the authoritative chat log, so a message that failed to
            // store is not broadcast: it would vanish on the next reload. The author
            // (and only the author) is told, and every reader of the log agrees.
            log.error("chat.persist_failed", {
              actionId,
              error,
              tableId,
              userId,
            });
            connection.send(
              errorMessage({
                actionId,
                code: "chat_not_persisted",
                message: "chat_not_persisted",
                tableId,
              }),
            );
            return;
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
  /** Present on a rate-limited refusal so the client knows when to retry. */
  retryAfterMs?: number;
}): ServerMessage {
  return {
    actionId: input.actionId,
    code: input.code,
    message: input.message,
    retryAfterMs: input.retryAfterMs,
    tableId: input.tableId,
    type: "error",
    v: PROTOCOL_VERSION,
  };
}
