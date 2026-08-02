import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "./db/client";
import * as schema from "./db/schema";
import { env } from "./env";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.PUBLIC_WEB_URL],
  emailAndPassword: { enabled: true },
});

export const getSessionFromHeaders = (headers: Headers) =>
  auth.api.getSession({ headers });
