import type { Json } from "./module";
import type { ClientMessage } from "./protocol";

export type ClientIntent = { type: string; payload: Json };

export function intentFromClientMessage(
  msg: Extract<ClientMessage, { type: "intent" }>,
): { type: string; payload: Json } {
  return { type: msg.intentType, payload: msg.payload };
}
