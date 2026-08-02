import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectTableWs } from "./ws";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.onclose?.();
  }
}

describe("connectTableWs", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    Object.assign(globalThis, { WebSocket: MockWebSocket });
  });

  afterEach(() => {
    Object.assign(globalThis, { WebSocket: originalWebSocket });
  });

  it("connects to /ws and subscribes on open", () => {
    const onMessage = vi.fn();
    const socket = connectTableWs({
      apiUrl: "https://api.yatzy.test",
      tableId: "table-123",
      onMessage,
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toBe("wss://api.yatzy.test/ws");

    MockWebSocket.instances[0]?.onopen?.();

    expect(MockWebSocket.instances[0]?.sent).toEqual([
      JSON.stringify({
        v: 1,
        type: "subscribe",
        tableId: "table-123",
      }),
    ]);

    socket.close();
  });

  it("forwards parsed server messages and can send client messages", () => {
    const onMessage = vi.fn();
    const ws = connectTableWs({
      apiUrl: "http://localhost:3001",
      tableId: "table-456",
      onMessage,
    });
    const instance = MockWebSocket.instances[0];

    instance?.onmessage?.({
      data: JSON.stringify({
        v: 1,
        type: "presence",
        tableId: "table-456",
        onlineUserIds: ["user-a"],
      }),
    } as MessageEvent<string>);

    expect(onMessage).toHaveBeenCalledWith({
      v: 1,
      type: "presence",
      tableId: "table-456",
      onlineUserIds: ["user-a"],
    });

    ws.send({
      v: 1,
      type: "intent",
      tableId: "table-456",
      actionId: "action-1",
      intentType: "roll",
      payload: {},
    });

    expect(instance?.sent.at(-1)).toBe(
      JSON.stringify({
        v: 1,
        type: "intent",
        tableId: "table-456",
        actionId: "action-1",
        intentType: "roll",
        payload: {},
      }),
    );
  });
});
