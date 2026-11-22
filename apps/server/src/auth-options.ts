import { drizzleAdapter } from "better-auth/adapters/drizzle";

import * as schema from "./db/schema";
import { env } from "./env";
import type { Mailer } from "./mail";

/**
 * One budget for the routes an attacker actually spends attempts on: the ones
 * that compare a password or send mail. `/get-session` and friends keep
 * better-auth's defaults, because a table full of players behind one address is
 * a legitimate burst, not an attack.
 */
const authAttemptRule = () => ({
  window: env.AUTH_RATE_WINDOW_SECONDS,
  max: env.AUTH_RATE_LIMIT,
});

export type AuthOptionsDeps = {
  /**
   * Everything the auth instance needs to reach a mailbox. Required, so a test
   * passes `captureMailer()` and reads the reset link instead of describing it.
   */
  mailer: Mailer;
  /** Defaults to `AUTH_REQUIRE_VERIFICATION`; the integration suite overrides it. */
  requireVerification?: boolean;
};

/**
 * Links a human clicks land on the web app, not on the API.
 *
 * better-auth hands `sendResetPassword` a URL that points at its own
 * `/reset-password/:token` endpoint (which redirects onward), and
 * `sendVerificationEmail` one that points at `/verify-email`. Both are built
 * from `baseURL` and both carry a `callbackURL` the sender passes in, which is
 * exactly the shape of an open redirect. Building the link from `PUBLIC_WEB_URL`
 * and the raw token instead keeps the mail on the origin users already know,
 * drops the redirect hop, and means the token is spent by a `POST` from the page
 * rather than by whatever a mail client decides to fetch.
 */
const resetLink = (token: string) =>
  `${env.PUBLIC_WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;

const verificationLink = (token: string) =>
  `${env.PUBLIC_WEB_URL}/verify-email?token=${encodeURIComponent(token)}`;

const resetMessage = (to: string, name: string, token: string) => ({
  body: [
    `Hi ${name},`,
    "",
    "Someone asked to reset the password for this Roundhouse account.",
    "Open this link to choose a new one:",
    "",
    resetLink(token),
    "",
    "The link works once and expires in an hour. If this was not you, ignore",
    "this message; your password stays as it is.",
  ].join("\n"),
  subject: "Reset your Roundhouse password",
  to,
});

const verificationMessage = (to: string, name: string, token: string) => ({
  body: [
    `Hi ${name},`,
    "",
    "Confirm this address to finish setting up your Roundhouse account:",
    "",
    verificationLink(token),
    "",
    "If you did not create a Roundhouse account, ignore this message.",
  ].join("\n"),
  subject: "Confirm your Roundhouse address",
  to,
});

/**
 * The options are a factory, separate from the singleton in `auth.ts`, so the
 * integration suite can build the same auth instance over the throwaway
 * database. A test that rebuilt these options by hand would stop covering the
 * limits the moment one of them changed here.
 */
export function createAuthOptions(
  database: Parameters<typeof drizzleAdapter>[0],
  deps: AuthOptionsDeps,
) {
  const requireVerification = deps.requireVerification ?? env.AUTH_REQUIRE_VERIFICATION;
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        }
      : null;

  return {
    database: drizzleAdapter(database, { provider: "pg" as const, schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.PUBLIC_WEB_URL],
    emailAndPassword: {
      enabled: true,
      /** An unproven address is refused at sign-in, not quietly accepted. */
      requireEmailVerification: requireVerification,
      /** One hour, better-auth's default made explicit. */
      resetPasswordTokenExpiresIn: 60 * 60,
      /**
       * A reset is what someone does when they think a password leaked, so the
       * sessions that leaked it must not survive: better-auth deletes them when
       * this flag is set.
       */
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({
        user,
        token,
      }: {
        user: { email: string; name?: string | null };
        token: string;
      }) => {
        await deps.mailer.send(resetMessage(user.email, user.name || "there", token));
      },
    },
    emailVerification: {
      /** Every new account gets the mail, whether or not sign-in needs it. */
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({
        user,
        token,
      }: {
        user: { email: string; name?: string | null };
        token: string;
      }) => {
        await deps.mailer.send(verificationMessage(user.email, user.name || "there", token));
      },
    },
    /** Registered only when both halves exist, so an unset deployment has no button. */
    ...(google ? { socialProviders: { google } } : {}),
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

/** `{ google: false }` is a real answer, not a missing route. */
export function socialProviderStatus() {
  return { google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) };
}
