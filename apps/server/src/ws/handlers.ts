import { intentFromClientMessage, type ClientMessage, type ServerMessage } from "@yatzy/game-core";

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
}) {
  const { isDuplicateAction, publishToTable, rememberAction, runtime } = deps;

  return {
    async onMessage(connection: WsConnection, message: ClientMessage) {
      if (message.type === "intent") {
        if (isDuplicateAction(message.tableId, message.actionId)) {
          return;
        }

        const result = await runtime.applyGameIntent({
          intent: intentFromClientMessage(message),
          tableId: message.tableId,
          userId: connection.userId,
        });

        if (!result.ok) {
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

        rememberAction(message.tableId, message.actionId);
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
