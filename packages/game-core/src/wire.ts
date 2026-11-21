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
  status: z.enum(["lobby", "active", "finished"]),
});

export const chatWireSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  snapshot: jsonSchema,
  text: z.string(),
  userId: z.string(),
});

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

/** Client → server over WS. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ tableId: idSchema, type: z.literal("subscribe"), v: z.literal(1) }),
  z.object({
    actionId: idSchema,
    intentType: z.string().min(1).max(64),
    payload: jsonSchema,
    tableId: idSchema,
    type: z.literal("intent"),
    v: z.literal(1),
  }),
  z.object({
    actionId: idSchema,
    tableId: idSchema,
    text: chatTextSchema,
    type: z.literal("chat"),
    v: z.literal(1),
  }),
]);

/** Server → client over WS. #14 replaces the event-by-event `event` frame. */
export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    meta: tableMetaSchema,
    seq: z.number().int(),
    state: jsonSchema,
    tableId: idSchema,
    type: z.literal("snapshot"),
    v: z.literal(1),
  }),
  z.object({ event: eventEnvelopeSchema, tableId: idSchema, type: z.literal("event"), v: z.literal(1) }),
  z.object({ message: chatWireSchema, tableId: idSchema, type: z.literal("chat"), v: z.literal(1) }),
  z.object({
    actionId: idSchema.optional(),
    code: z.string(),
    message: z.string(),
    tableId: idSchema.optional(),
    type: z.literal("error"),
    v: z.literal(1),
  }),
  z.object({
    onlineUserIds: z.array(z.string()),
    tableId: idSchema,
    type: z.literal("presence"),
    v: z.literal(1),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** The two frames a table handler acts on; `subscribe` is the hub's own business. */
export type ClientIntentMessage = Extract<ClientMessage, { type: "intent" }>;
export type ClientChatMessage = Extract<ClientMessage, { type: "chat" }>;
export type ClientTableMessage = ClientIntentMessage | ClientChatMessage;

export type ClientMessageErrorCode = "bad_message" | "unknown_message_type";

export type ParseClientMessageResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: ClientMessageErrorCode; detail: string };

const KNOWN_TYPES: readonly string[] = ["subscribe", "intent", "chat"];

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
