import { betterAuth } from "better-auth";

import { createAuthOptions } from "./auth-options";
import { db } from "./db/client";
import { env } from "./env";
import { logger } from "./log";
import { createMailer } from "./mail";

/**
 * One mailer per process, chosen by `MAIL_TRANSPORT`. Building it here rather
 * than inside the auth options keeps the transport decision visible at boot: a
 * half-configured SMTP setup fails now, not on the first password reset.
 */
export const mailer = createMailer({
  from: env.MAIL_FROM,
  logger,
  smtpUrl: env.MAIL_SMTP_URL,
  transport: env.MAIL_TRANSPORT,
});

export const auth = betterAuth(createAuthOptions(db, { mailer }));

export const getSessionFromHeaders = (headers: Headers) => auth.api.getSession({ headers });
