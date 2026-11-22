import "dotenv/config";

import { z } from "zod";

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
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
});

type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

const loadEnv = () => {
  cachedEnv ??= envSchema.parse(process.env);
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
