import type { z } from "zod";

import type { Json } from "./module";
import type { ClientMessage } from "./protocol";

export type ClientIntent = { type: string; payload: Json };

export function intentFromClientMessage(
  msg: Extract<ClientMessage, { type: "intent" }>,
): ClientIntent {
  return { type: msg.intentType, payload: msg.payload };
}

export type IntentParseResult =
  | { ok: true; intent: ClientIntent }
  | { ok: false; code: "unknown_intent" | "invalid_payload"; detail: string };

/**
 * Checks one intent against the module's declared schemas before `reduce` sees it.
 *
 * Nothing else in the pipeline knows what an intent payload should look like, so
 * this is the only place that can turn "the client sent something" into "the
 * module said it would accept something". Modules stay free to validate again
 * inside `reduce` — this is the outer boundary, not a replacement for it.
 */
export function parseIntent(
  schemas: Readonly<Record<string, z.ZodType>>,
  intent: ClientIntent,
): IntentParseResult {
  const schema = schemas[intent.type];
  if (!schema) {
    return { code: "unknown_intent", detail: intent.type, ok: false };
  }

  const parsed = schema.safeParse(intent.payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { code: "invalid_payload", detail, ok: false };
  }

  // The schema's output is the payload the module declared it accepts, so it is
  // JSON by construction. The cast exists because `z.ZodType` erases its output
  // type; it is the only cast on the inbound intent path.
  return { intent: { payload: parsed.data as Json, type: intent.type }, ok: true };
}
