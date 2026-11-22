import { z } from "zod";

import type { EventEnvelope, Json } from "./module";

/**
 * Single source of truth for everything that crosses the socket (ADR 0001).
 *
 * A frame either matches one of these schemas or it never reaches a handler, so
 * the client and server cannot drift while both typecheck: the types below are
 * `z.infer` of the schemas, not hand-written unions beside them.
 */

/**
 * Recursive JSON value. The annotation pins the inferred type to `Json` instead
 * of letting the recursive edge degrade to `any`.
 */
export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);

/** Opaque identifiers are capped so one frame cannot carry megabytes of id. */
const idSchema = z.string().min(1).max(64);

/** Chat text is truncated to 500 characters when stored; reject the absurd early. */
const chatTextSchema = z.string().max(4000);

export const tableMetaSchema = z.object({
  code: z.string(),
  config: jsonSchema,
  gameId: z.string(),
  hostUserId: z.string(),
  seatUserIds: z.array(z.string()),
  softSeatCap: z.number().int(),
  /**
   * Whether someone without a seat may watch this table (M2-1, #56). A private
   * table answers `not_seated` exactly as it always did.
   */
  spectatorsAllowed: z.boolean(),
  status: z.enum(["lobby", "active", "finished"]),
});

export const chatWireSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  snapshot: jsonSchema,
  text: z.string(),
  userId: z.string(),
});

/**
 * One game the server can host. The lobby renders this list instead of knowing
 * which games exist, so adding a module never edits the web app.
 */
export const gameCatalogueEntrySchema = z.object({
  defaultConfig: jsonSchema,
  displayName: z.string(),
  id: z.string(),
  playerCount: z.object({ max: z.number().int(), min: z.number().int() }),
});

export const gameCatalogueSchema = z.array(gameCatalogueEntrySchema);
export const eventEnvelopeSchema: z.ZodType<EventEnvelope> = z.object({
  actorId: z.string().nullable(),
  createdAt: z.string(),
  gameId: z.string(),
  id: z.string(),
  payload: jsonSchema,
  seq: z.number().int(),
  tableId: z.string(),
  type: z.string(),
});

export type TableMeta = z.infer<typeof tableMetaSchema>;
export type ChatWire = z.infer<typeof chatWireSchema>;
export type GameCatalogueEntry = z.infer<typeof gameCatalogueEntrySchema>;

/** Protocol revision. A v1 client is refused by the parser, not tolerated. */
export const PROTOCOL_VERSION = 2 as const;

/** Game progress is a monotonic counter, so it can never be negative. */
const seqSchema = z.number().int().min(0);

/** Client → server over WS. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  // `sinceSeq` lets a reconnecting client ask for only what it missed: the hub
  // answers with `events` when the gap is small enough to replay, else `snapshot`.
  z.object({
    sinceSeq: seqSchema.optional(),
    tableId: idSchema,
    type: z.literal("subscribe"),
    v: z.literal(PROTOCOL_VERSION),
  }),
  // The repair path. A client that notices a seq gap asks for the frames it
  // missed instead of reloading the table.
  z.object({
    sinceSeq: seqSchema,
    tableId: idSchema,
    type: z.literal("sync"),
    v: z.literal(PROTOCOL_VERSION),
  }),
  // Chat is paged: the newest page on first paint, older pages by cursor.
  z.object({
    beforeId: idSchema.optional(),
    tableId: idSchema,
    type: z.literal("chatPage"),
    v: z.literal(PROTOCOL_VERSION),
  }),
  z.object({
    actionId: idSchema,
    intentType: z.string().min(1).max(64),
    payload: jsonSchema,
    tableId: idSchema,
    type: z.literal("intent"),
    v: z.literal(PROTOCOL_VERSION),
  }),
  z.object({
    actionId: idSchema,
    tableId: idSchema,
    text: chatTextSchema,
    type: z.literal("chat"),
    v: z.literal(PROTOCOL_VERSION),
  }),
]);

/**
 * Server → client over WS.
 *
 * `applied` and `events` both carry the authoritative state for their `seq`, so
 * a client never reconstructs state from events; the events ride along for
 * animation and history only.
 */
export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    meta: tableMetaSchema,
    seq: seqSchema,
    state: jsonSchema,
    tableId: idSchema,
    type: z.literal("snapshot"),
    v: z.literal(PROTOCOL_VERSION),
  }),
  z.object({
    events: z.array(eventEnvelopeSchema),
    meta: tableMetaSchema,
    seq: seqSchema,
    state: jsonSchema,
    tableId: idSchema,
    type: z.literal("applied"),
    v: z.literal(PROTOCOL_VERSION),
  }),
  z.object({
    events: z.array(eventEnvelopeSchema),
    fromSeq: seqSchema,
    meta: tableMetaSchema,
    state: jsonSchema,
    tableId: idSchema,
    toSeq: seqSchema,
    type: z.literal("events"),
    v: z.literal(PROTOCOL_VERSION),
  }),
  z.object({
    message: chatWireSchema,
    tableId: idSchema,
    type: z.literal("chat"),
    v: z.literal(PROTOCOL_VERSION),
  }),
  // Sender-only echo of a chat message, so the author sees their line without
  // being told it came from the table broadcast.
  z.object({
    message: chatWireSchema,
    tableId: idSchema,
    type: z.literal("spoke"),
    v: z.literal(PROTOCOL_VERSION),
  }),
  // Answer to `chatPage`. A bounded page needs one frame: N `chat` frames would
  // leave the client unable to tell "page ended" from "more is coming".
  z.object({
    hasMore: z.boolean(),
    messages: z.array(chatWireSchema),
    tableId: idSchema,
    type: z.literal("chatPage"),
    v: z.literal(PROTOCOL_VERSION),
  }),
  z.object({
    onlineUserIds: z.array(z.string()),
    // Who is watching without a seat. A player is only ever listed in
    // `onlineUserIds`, so the two lists never overlap (M2-1, #56).
    spectatorUserIds: z.array(z.string()),
    tableId: idSchema,
    type: z.literal("presence"),
    v: z.literal(PROTOCOL_VERSION),
  }),
  z.object({
    actionId: idSchema.optional(),
    code: z.string(),
    message: z.string(),
    // A refusal that cannot say when to come back forces the client to guess or
    // hammer; only a rate-limited frame carries it.
    retryAfterMs: z.number().int().nonnegative().optional(),
    tableId: idSchema.optional(),
    type: z.literal("error"),
    v: z.literal(PROTOCOL_VERSION),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export type ClientSubscribeMessage = Extract<ClientMessage, { type: "subscribe" }>;
export type ClientSyncMessage = Extract<ClientMessage, { type: "sync" }>;
export type ClientChatPageMessage = Extract<ClientMessage, { type: "chatPage" }>;
export type ClientIntentMessage = Extract<ClientMessage, { type: "intent" }>;
export type ClientChatMessage = Extract<ClientMessage, { type: "chat" }>;

/** Frames the table handlers act on; subscribe/sync/chatPage are the hub's business. */
export type ClientTableMessage = ClientIntentMessage | ClientChatMessage;
export type ClientMessageErrorCode = "bad_message" | "unknown_message_type";

export type ParseClientMessageResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: ClientMessageErrorCode; detail: string };

const KNOWN_TYPES: readonly string[] = ["subscribe", "sync", "chatPage", "intent", "chat"];

/**
 * Parses one inbound frame. Never throws and never returns `any`: the caller
 * either gets a validated union member or a code it can answer with. A bad frame
 * is a rejected frame, not a dropped connection.
 */
export function parseClientMessage(raw: string): ParseClientMessageResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { code: "bad_message", detail: "invalid_json", ok: false };
  }

  const result = clientMessageSchema.safeParse(value);
  if (result.success) {
    return { message: result.data, ok: true };
  }

  const declaredType =
    typeof value === "object" && value !== null ? (value as { type?: unknown }).type : undefined;
  const code: ClientMessageErrorCode =
    typeof declaredType === "string" && !KNOWN_TYPES.includes(declaredType)
      ? "unknown_message_type"
      : "bad_message";

  return { code, detail: summarizeIssues(result.error), ok: false };
}

function summarizeIssues(error: z.ZodError) {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
