import type { ClientMessage, ServerMessage } from "@yatzy/game-core";

function toWebSocketUrl(apiUrl: string) {
  const url = new URL("/ws", apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function connectTableWs(opts: {
  apiUrl: string;
  tableId: string;
  onMessage: (msg: ServerMessage) => void;
}): { send: (message: ClientMessage) => void; close: () => void } {
  const socket = new WebSocket(toWebSocketUrl(opts.apiUrl));

  socket.onopen = () => {
    socket.send(
      JSON.stringify({
        v: 1,
        type: "subscribe",
        tableId: opts.tableId,
      } satisfies ClientMessage),
    );
  };

  socket.onmessage = (event) => {
    opts.onMessage(JSON.parse(event.data) as ServerMessage);
  };

  return {
    send(message) {
      socket.send(JSON.stringify(message));
    },
    close() {
      socket.close();
    },
  };
}

export { toWebSocketUrl };
