import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  PUBLIC_WEB_URL: z.string().url(),
  PORT: z.coerce.number().default(3001),
});

export const env = envSchema.parse(process.env);
