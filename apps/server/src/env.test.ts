import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Boot-time environment validation.
 *
 * The point of these tests is the failure, not the success: an integration that
 * is half configured must stop the process at startup, where an operator sees
 * it, instead of failing on the first password reset at 3am. Each case imports
 * `./env` afresh because the module caches the parse.
 */

const base = {
  // Spelled out so secret scanners can see it is not one.
  BETTER_AUTH_SECRET: "unit-test-only-secret-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3001",
  DATABASE_URL: "postgres://roundhouse:roundhouse@127.0.0.1:5432/roundhouse",
  PUBLIC_WEB_URL: "http://localhost:5173",
};

const optionalKeys = [
  "AUTH_REQUIRE_VERIFICATION",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MAIL_FROM",
  "MAIL_SMTP_URL",
  "MAIL_TRANSPORT",
  "TRUST_PROXY",
];

type Env = Record<string, unknown>;

type Boot = { ok: true; env: Env } | { ok: false; message: string };

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

async function boot(overrides: Record<string, string | undefined> = {}): Promise<Boot> {
  vi.resetModules();
  for (const key of optionalKeys) delete process.env[key];
  Object.assign(process.env, base, overrides);

  const { getEnv } = await import("./env");
  try {
    return { env: getEnv() as unknown as Env, ok: true };
  } catch (error) {
    return { message: String(error), ok: false };
  }
}

describe("env boot validation", () => {
  it("defaults to logging mail and not requiring verification", async () => {
    const booted = await boot();
    expect(booted.ok).toBe(true);
    if (!booted.ok) return;

    expect(booted.env.MAIL_TRANSPORT).toBe("log");
    expect(booted.env.MAIL_FROM).toContain("@");
    expect(booted.env.AUTH_REQUIRE_VERIFICATION).toBe(false);
    expect(booted.env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(booted.env.TRUST_PROXY).toBe(false);
  });

  it("refuses MAIL_TRANSPORT=smtp with no server to talk to", async () => {
    const booted = await boot({ MAIL_TRANSPORT: "smtp" });
    expect(booted.ok).toBe(false);
    if (booted.ok) return;
    expect(booted.message).toMatch(/MAIL_SMTP_URL/);
    expect(booted.message).toMatch(/smtp:\/\/user:pass@host:587/);
  });

  it("accepts a complete smtp setup", async () => {
    const booted = await boot({
      MAIL_SMTP_URL: "smtp://user:pass@smtp.example.test:587",
      MAIL_TRANSPORT: "smtp",
    });
    expect(booted.ok).toBe(true);
    if (!booted.ok) return;
    expect(booted.env.MAIL_TRANSPORT).toBe("smtp");
  });

  it("refuses half a Google client instead of drawing a button that cannot work", async () => {
    const booted = await boot({ GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com" });
    expect(booted.ok).toBe(false);
    if (booted.ok) return;
    expect(booted.message).toMatch(/GOOGLE_CLIENT_SECRET/);

    const complete = await boot({
      GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "client-secret",
    });
    expect(complete.ok).toBe(true);
  });

  it("treats an empty variable as unset, which is what Compose and .env produce", async () => {
    const booted = await boot({
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      MAIL_SMTP_URL: "",
    });
    expect(booted.ok).toBe(true);
    if (!booted.ok) return;
    expect(booted.env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(booted.env.MAIL_SMTP_URL).toBeUndefined();
  });

  it("reads booleans as strings, so `false` stays false", async () => {
    const off = await boot({ AUTH_REQUIRE_VERIFICATION: "false", TRUST_PROXY: "false" });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    // `z.coerce.boolean()` would make the string "false" true; that is the bug
    // this case exists to catch.
    expect(off.env.AUTH_REQUIRE_VERIFICATION).toBe(false);
    expect(off.env.TRUST_PROXY).toBe(false);

    const on = await boot({ AUTH_REQUIRE_VERIFICATION: "true", TRUST_PROXY: "1" });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    expect(on.env.AUTH_REQUIRE_VERIFICATION).toBe(true);
    expect(on.env.TRUST_PROXY).toBe(true);
  });
});
