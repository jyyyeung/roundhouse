/**
 * Wire types live in `wire.ts`, where they are inferred from the Zod schemas that
 * the server validates against. This module is the stable import path so callers
 * keep saying `import type { ClientMessage } from "@roundhouse/game-core"`.
 */
export type {
  ChatWire,
  ClientChatMessage,
  ClientChatPageMessage,
  ClientIntentMessage,
  ClientMessage,
  ClientMessageErrorCode,
  ClientSubscribeMessage,
  ClientSyncMessage,
  ClientTableMessage,
  ParseClientMessageResult,
  ServerMessage,
  TableMeta,
} from "./wire";
export { PROTOCOL_VERSION } from "./wire";
