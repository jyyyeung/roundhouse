import type { Json } from "@roundhouse/game-core";

/**
 * A chat message as the client holds it. Chat is a platform feature — every game
 * has one — so the message shape lives here rather than inside a game's folder.
 * `snapshot` is whatever state the sender was looking at; how to render that is
 * the game's business.
 */
export type TableChatMessage = {
  id: string;
  userId: string;
  text: string;
  createdAt: string;
  snapshot: Json;
};
