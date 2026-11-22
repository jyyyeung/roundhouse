import { describe, expect, it, vi } from "vitest";

import { createLogger } from "./log";
import { captureMailer, createMailer, logMailer, type MailMessage, smtpMailer } from "./mail";

const message: MailMessage = {
  body: "Open this link: http://localhost:5173/reset-password?token=abc",
  subject: "Reset your Roundhouse password",
  to: "player@example.test",
};

function capturingLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: "debug",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { lines, logger };
}

describe("log mailer", () => {
  it("writes one line with the recipient, the subject and the link", async () => {
    const { lines, logger } = capturingLogger();
    await logMailer({ logger }).send(message);

    expect(lines).toHaveLength(1);
    // The log *is* the mailbox for this transport, so the body travels with it:
    // that is how a developer completes a reset from `docker compose logs`.
    expect(lines[0]).toMatchObject({
      level: "info",
      msg: "mail.sent",
      subject: message.subject,
      to: message.to,
      transport: "log",
    });
    expect(String(lines[0]?.body)).toContain("token=abc");
  });
});

describe("capture mailer", () => {
  it("keeps messages until they are taken, oldest first", async () => {
    const mailer = captureMailer();
    await mailer.send(message);
    await mailer.send({ ...message, to: "second@example.test" });

    expect(mailer.messages.map((sent) => sent.to)).toEqual([
      "player@example.test",
      "second@example.test",
    ]);

    expect(mailer.take().map((sent) => sent.to)).toEqual([
      "player@example.test",
      "second@example.test",
    ]);
    expect(mailer.take()).toEqual([]);
  });
});

describe("smtp mailer", () => {
  it("loads the client only when the first message is sent, and only once", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "1" });
    const loadTransport = vi.fn().mockResolvedValue({ sendMail });
    const mailer = smtpMailer({
      from: "no-reply@example.test",
      loadTransport,
      smtpUrl: "smtp://x",
    });

    expect(loadTransport).not.toHaveBeenCalled();

    await mailer.send(message);
    await mailer.send({ ...message, to: "second@example.test" });

    expect(loadTransport).toHaveBeenCalledTimes(1);
    expect(loadTransport).toHaveBeenCalledWith("smtp://x");
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenLastCalledWith({
      from: "no-reply@example.test",
      html: undefined,
      subject: message.subject,
      text: message.body,
      to: "second@example.test",
    });
  });

  it("tries again after a connection that failed instead of staying broken", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "2" });
    const loadTransport = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValue({ sendMail });

    const mailer = smtpMailer({
      from: "no-reply@example.test",
      loadTransport,
      smtpUrl: "smtp://x",
    });

    await expect(mailer.send(message)).rejects.toThrow("connection refused");
    await expect(mailer.send(message)).resolves.toBeUndefined();
    expect(loadTransport).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe("create mailer", () => {
  it("picks the log transport by default and never needs smtp settings", async () => {
    const { lines, logger } = capturingLogger();
    await createMailer({ from: "no-reply@example.test", logger, transport: "log" }).send(message);
    expect(lines[0]?.msg).toBe("mail.sent");
  });

  it("refuses an smtp transport with no server rather than failing on the first reset", () => {
    const { logger } = capturingLogger();
    expect(() =>
      createMailer({ from: "no-reply@example.test", logger, transport: "smtp" }),
    ).toThrow(/MAIL_SMTP_URL/);
  });
});
