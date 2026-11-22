import "dotenv/config";

import { z } from "zod";

/**
 * A variable that may be absent, and is also absent when set to the empty
 * string: Compose interpolates `${VAR:-}` to `""` for every declared key, and a
 * `.env` line of `VAR=` does the same. Treating that as "configured as empty"
 * turns an optional integration into a boot failure.
 */
const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  PUBLIC_WEB_URL: z.string().url(),
  PORT: z.coerce.number().default(3001),
  /**
   * Intents one user may send to one table inside the window. Legitimate play is
   * a handful per turn; 20 per 10s is generous for a human and caps a client
   * stuck in a retry loop.
   */
  INTENT_RATE_LIMIT: z.coerce.number().int().positive().default(20),
  INTENT_RATE_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  /** Chat keeps its historical 5 messages per 10s per user per table. */
  CHAT_RATE_LIMIT: z.coerce.number().int().positive().default(5),
  CHAT_RATE_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  /** Auth attempts per client address per auth route inside the window. */
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  AUTH_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  /**
   * `true`/`1` when a reverse proxy sets `x-forwarded-for` (the shipped Compose
   * stack does). Default false: trusting the header from a direct client lets
   * the client choose which bucket it lands in.
   */
  PROBE_UNDOCUMENTED: z.string().optional(),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  /**
   * Where reset and verification mail goes. `log` (the default) writes one JSON
   * line instead of sending anything, so a fresh clone can complete a password
   * reset by reading `docker compose logs server`.
   */
  MAIL_TRANSPORT: z.enum(["log", "smtp"]).default("log"),
  /** Envelope sender, `Name <address>` or a bare address. */
  MAIL_FROM: z.string().min(3).default("Roundhouse <no-reply@roundhouse.local>"),
  /** Full SMTP URL, e.g. `smtp://user:pass@smtp.example.com:587`. */
  MAIL_SMTP_URL: optionalText,
  /**
   * Refuse to sign in an account that never proved it owns its address. On by
   * default in production; the README explains how to switch it on locally.
   */
  AUTH_REQUIRE_VERIFICATION: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  /** Google sign-in appears only when both halves are configured. */
  GOOGLE_CLIENT_ID: optionalText,
  GOOGLE_CLIENT_SECRET: optionalText,
});

/**
 * Half-configured integrations are refused at boot rather than at the first
 * password reset, when nobody is watching the logs.
 */
const envSchemaChecked = envSchema.superRefine((value, ctx) => {
  if (value.MAIL_TRANSPORT === "smtp" && !value.MAIL_SMTP_URL) {
    ctx.addIssue({
      code: "custom",
      message: "MAIL_TRANSPORT=smtp needs MAIL_SMTP_URL, e.g. smtp://user:pass@host:587",
      path: ["MAIL_SMTP_URL"],
    });
  }
  const hasId = Boolean(value.GOOGLE_CLIENT_ID);
  const hasSecret = Boolean(value.GOOGLE_CLIENT_SECRET);
  if (hasId !== hasSecret) {
    ctx.addIssue({
      code: "custom",
      message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together",
      path: [hasId ? "GOOGLE_CLIENT_SECRET" : "GOOGLE_CLIENT_ID"],
    });
  }
});

type Env = z.infer<typeof envSchemaChecked>;

let cachedEnv: Env | undefined;

const loadEnv = () => {
  cachedEnv ??= envSchemaChecked.parse(process.env);
  return cachedEnv;
};

export const env = new Proxy({} as Env, {
  get: (_target, prop) => loadEnv()[prop as keyof Env],
  has: (_target, prop) => prop in loadEnv(),
  ownKeys: () => Reflect.ownKeys(loadEnv()),
  getOwnPropertyDescriptor: (_target, prop) => ({
    configurable: true,
    enumerable: true,
    value: loadEnv()[prop as keyof Env],
    writable: false,
  }),
}) as Env;

export const getEnv = loadEnv;
