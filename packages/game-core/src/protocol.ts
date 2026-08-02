import type { Json } from "./module";

/** Client → server over WS */
export type ClientMessage =
  | { v: 1; type: "subscribe"; tableId: string }
  | { v: 1; type: "intent"; tableId: string; actionId: string; intentType: string; payload: Json }
  | { v: 1; type: "chat"; tableId: string; actionId: string; text: string };

/** Server → client over WS */
export type ServerMessage =
  | { v: 1; type: "snapshot"; tableId: string; seq: number; state: Json; meta: TableMeta }
  | { v: 1; type: "event"; tableId: string; event: import("./module").EventEnvelope }
  | { v: 1; type: "chat"; tableId: string; message: ChatWire }
  | { v: 1; type: "error"; tableId?: string; actionId?: string; code: string; message: string }
  | { v: 1; type: "presence"; tableId: string; onlineUserIds: string[] };

export type TableMeta = {
  code: string;
  gameId: string;
  config: Json;
  status: "lobby" | "active" | "finished";
  hostUserId: string;
  seatUserIds: string[];
  softSeatCap: number;
};

export type ChatWire = {
  id: string;
  userId: string;
  text: string;
  snapshot: Json;
  createdAt: string;
};

