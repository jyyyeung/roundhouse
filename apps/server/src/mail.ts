import type { Logger } from "./log";

/**
 * Mail is an interface, not a dependency.
 *
 * Three implementations, chosen once at boot by `MAIL_TRANSPORT`:
 *
 * - **`logMailer`** (the default) writes one JSON line. A developer who clones
 *   the repo gets a working password reset with no mailbox, no SMTP server and
 *   no credentials, and the link is right there in `docker compose logs`.
 * - **`smtpMailer`** talks SMTP, and only loads a mail client when it is built:
 *   `nodemailer` is imported inside `send`, so the default process never touches
 *   it and a misconfiguration cannot fail at import time.
 * - **`captureMailer`** keeps messages in an array for tests, so a suite can
 *   assert exactly what would have been sent without a network or a fake clock.
 *
 * Nothing here decides *what* to send; `auth-options.ts` builds the reset and
 * verification messages. The mailer only moves them.
 */

export type MailMessage = {
  /** Plain text the recipient can read in any client. */
  body: string;
  /** Optional HTML alternative; the text body stays authoritative. */
  html?: string;
  subject: string;
  to: string;
};

export type Mailer = {
  send(message: MailMessage): Promise<void>;
};

export type CapturingMailer = Mailer & {
  /** Everything sent so far, oldest first. */
  readonly messages: readonly MailMessage[];
  /** The messages sent since the last call, and forget them. */
  take(): MailMessage[];
};

/**
 * The log *is* the mailbox for this transport, body and link included: the point
 * of `MAIL_TRANSPORT=log` is that a developer can finish a password reset by
 * reading `docker compose logs server`. That makes every logged link a
 * credential in a log file, so this transport is for a local or single-trusted-
 * operator deployment, and the README says so next to the SMTP instructions.
 */
export function logMailer(deps: { logger: Logger }): Mailer {
  return {
    send(message) {
      deps.logger.info("mail.sent", {
        body: message.body,
        subject: message.subject,
        to: message.to,
        transport: "log",
      });
      return Promise.resolve();
    },
  };
}

export function captureMailer(): CapturingMailer {
  const messages: MailMessage[] = [];
  return {
    messages,
    send(message) {
      messages.push(message);
      return Promise.resolve();
    },
    take() {
      return messages.splice(0, messages.length);
    },
  };
}

type SmtpTransport = {
  sendMail: (message: {
    from: string;
    html?: string;
    subject: string;
    text: string;
    to: string;
  }) => Promise<unknown>;
};

/**
 * The one thing `smtpMailer` needs from a mail client, so a test can connect a
 * fake transport and never import `nodemailer` at all.
 */
export type TransportLoader = (smtpUrl: string) => Promise<SmtpTransport>;

export function smtpMailer(deps: {
  from: string;
  loadTransport: TransportLoader;
  smtpUrl: string;
}): Mailer {
  let transport: Promise<SmtpTransport> | null = null;

  const connect = () => {
    transport ??= deps.loadTransport(deps.smtpUrl).catch((error: unknown) => {
      // A refused connection must not poison every later send: forget the
      // failed attempt so the next message tries again instead of re-throwing a
      // promise from hours ago.
      transport = null;
      throw error;
    });
    return transport;
  };

  return {
    async send(message) {
      const connection = await connect();
      await connection.sendMail({
        from: deps.from,
        html: message.html,
        subject: message.subject,
        text: message.body,
        to: message.to,
      });
    },
  };
}

/** Loads `nodemailer` only when an SMTP transport is actually used. */
async function loadNodemailerTransport(smtpUrl: string): Promise<SmtpTransport> {
  const module = await import("nodemailer");
  const createTransport = module.createTransport ?? module.default?.createTransport;
  if (!createTransport) {
    throw new Error("nodemailer did not expose createTransport");
  }
  return createTransport(smtpUrl) as unknown as SmtpTransport;
}

export type MailerOptions = {
  /** Used by `logMailer` and by `smtpMailer` as the envelope sender. */
  from: string;
  logger: Logger;
  /** Test seam: replace the lazy `nodemailer` load. */
  loadTransport?: TransportLoader;
  smtpUrl?: string;
  transport: "log" | "smtp";
};

export function createMailer(options: MailerOptions): Mailer {
  if (options.transport === "log") return logMailer({ logger: options.logger });
  if (!options.smtpUrl) {
    // Env validation refuses this at boot; the throw keeps a hand-built mailer
    // from failing later, on the first password reset, instead of now.
    throw new Error("MAIL_TRANSPORT=smtp needs MAIL_SMTP_URL");
  }
  return smtpMailer({
    from: options.from,
    loadTransport: options.loadTransport ?? loadNodemailerTransport,
    smtpUrl: options.smtpUrl,
  });
}
