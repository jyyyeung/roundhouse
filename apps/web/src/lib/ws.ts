import type { ClientMessage, ServerMessage } from "@roundhouse/game-core";
import { PROTOCOL_VERSION } from "@roundhouse/game-core";

function toWebSocketUrl(apiUrl: string) {
  const url = new URL("/ws", apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export type TableWsConnection = {
  send: (message: ClientMessage) => boolean;
  close: () => void;
  isOpen: () => boolean;
};

export function connectTableWs(opts: {
  apiUrl: string;
  tableId: string;
  onMessage: (msg: ServerMessage) => void;
  onConnectionLost?: (reason: string) => void;
}): TableWsConnection {
  const socket = new WebSocket(toWebSocketUrl(opts.apiUrl));
  let intentionalClose = false;
  let opened = false;
  let lostNotified = false;

  function notifyLost(reason: string) {
    if (intentionalClose || lostNotified) return;
    lostNotified = true;
    opts.onConnectionLost?.(reason);
  }

  socket.onopen = () => {
    opened = true;
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "subscribe",
        tableId: opts.tableId,
      } satisfies ClientMessage),
    );
  };

  socket.onmessage = (event) => {
    opts.onMessage(JSON.parse(event.data) as ServerMessage);
  };

  socket.onerror = () => {
    notifyLost("websocket_error");
  };

  socket.onclose = (event) => {
    if (intentionalClose) return;
    if (event.code === 4401) {
      notifyLost("not_authenticated");
      return;
    }
    // 1012 is "service restart": the server said goodbye on purpose, so the caller
    // may reconnect at once instead of backing off from a failure.
    if (event.code === 1012) {
      notifyLost("server_restart");
      return;
    }
    notifyLost(opened ? `websocket_closed_${event.code}` : "websocket_failed");
  };

  return {
    send(message) {
      if (socket.readyState !== WebSocket.OPEN) {
        notifyLost("websocket_not_open");
        return false;
      }
      socket.send(JSON.stringify(message));
      return true;
    },
    isOpen() {
      return socket.readyState === WebSocket.OPEN;
    },
    close() {
      intentionalClose = true;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
  };
}

export { toWebSocketUrl };
