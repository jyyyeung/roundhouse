import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectTableWs } from "./ws";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
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

    MockWebSocket.instances[0]?.open();

    expect(MockWebSocket.instances[0]?.sent).toEqual([
      JSON.stringify({
        v: 2,
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
    instance?.open();

    instance?.onmessage?.({
      data: JSON.stringify({
        v: 2,
        type: "presence",
        tableId: "table-456",
        onlineUserIds: ["user-a"],
      }),
    } as MessageEvent<string>);

    expect(onMessage).toHaveBeenCalledWith({
      v: 2,
      type: "presence",
      tableId: "table-456",
      onlineUserIds: ["user-a"],
    });

    expect(
      ws.send({
        v: 2,
        type: "intent",
        tableId: "table-456",
        actionId: "action-1",
        intentType: "roll",
        payload: {},
      }),
    ).toBe(true);

    expect(instance?.sent.at(-1)).toBe(
      JSON.stringify({
        v: 2,
        type: "intent",
        tableId: "table-456",
        actionId: "action-1",
        intentType: "roll",
        payload: {},
      }),
    );
  });

  it("does not send on a closed socket and reports connection lost", () => {
    const onConnectionLost = vi.fn();
    const ws = connectTableWs({
      apiUrl: "http://localhost:3001",
      tableId: "table-456",
      onMessage: vi.fn(),
      onConnectionLost,
    });
    const instance = MockWebSocket.instances[0];
    instance?.open();
    instance!.readyState = MockWebSocket.CLOSED;

    expect(
      ws.send({
        v: 2,
        type: "chat",
        tableId: "table-456",
        actionId: "action-1",
        text: "hi",
      }),
    ).toBe(false);
    expect(onConnectionLost).toHaveBeenCalledWith("websocket_not_open");
    expect(instance?.sent).toHaveLength(1);
  });

  it("reports auth close via onConnectionLost", () => {
    const onConnectionLost = vi.fn();
    connectTableWs({
      apiUrl: "http://localhost:3001",
      tableId: "table-789",
      onMessage: vi.fn(),
      onConnectionLost,
    });

    MockWebSocket.instances[0]?.open();
    MockWebSocket.instances[0]?.onclose?.({ code: 4401 });

    expect(onConnectionLost).toHaveBeenCalledWith("not_authenticated");
  });
});
