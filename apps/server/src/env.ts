import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  PUBLIC_WEB_URL: z.string().url(),
  PORT: z.coerce.number().default(3001),
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
