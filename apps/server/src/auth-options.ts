import { drizzleAdapter } from "better-auth/adapters/drizzle";

import * as schema from "./db/schema";
import { env } from "./env";

/**
 * One budget for the routes an attacker actually spends attempts on: the ones
 * that compare a password or send mail. `/get-session` and friends keep
 * better-auth's defaults, because a table full of players behind one address is
 * a legitimate burst, not an attack.
 *
 * `/request-password-reset` and `/send-verification-email` do not exist until
 * M1-1 lands; naming them here means they arrive already limited instead of
 * shipping a mail-spray endpoint for one release.
 */
const authAttemptRule = () => ({
  window: env.AUTH_RATE_WINDOW_SECONDS,
  max: env.AUTH_RATE_LIMIT,
});

/**
 * The options are a factory, separate from the singleton in `auth.ts`, so the
 * integration suite can build the same auth instance over the throwaway
 * database. A test that rebuilt these options by hand would stop covering the
 * limits the moment one of them changed here.
 */
export function createAuthOptions(database: Parameters<typeof drizzleAdapter>[0]) {
  return {
    database: drizzleAdapter(database, { provider: "pg" as const, schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.PUBLIC_WEB_URL],
    emailAndPassword: { enabled: true },
    rateLimit: {
      // Explicit rather than implied: better-auth only enables this in production,
      // and a limit that silently disappears outside production is a limit nobody
      // has tested. Storage is per-process memory, so N replicas allow N budgets.
      enabled: true,
      storage: "memory" as const,
      customRules: {
        "/sign-in/email": authAttemptRule(),
        "/sign-up/email": authAttemptRule(),
        "/forget-password": authAttemptRule(),
        "/request-password-reset": authAttemptRule(),
        "/send-verification-email": authAttemptRule(),
      },
    },
  };
}
