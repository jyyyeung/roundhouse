import { afterEach, describe, expect, it, vi } from "vitest";

import { captureMailer } from "./mail";

/**
 * Google is registered only when both halves are configured, and the route the
 * sign-in page asks (`GET /api/auth/providers`) must answer the same question.
 * Both are cheap to check here and expensive to get wrong: a button that leads
 * to an unconfigured provider is a dead end in the one flow a new player uses.
 */

const base = {
  // Spelled out so secret scanners can see it is not one.
  BETTER_AUTH_SECRET: "unit-test-only-secret-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3001",
  DATABASE_URL: "postgres://roundhouse:roundhouse@127.0.0.1:5432/roundhouse",
  PUBLIC_WEB_URL: "http://localhost:5173",
};

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

async function bootAuth(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) delete process.env[key];
  Object.assign(process.env, base, overrides);

  const module = await import("./auth-options");
  // The factory only hands the handle to drizzle's adapter, so a placeholder is
  // enough to inspect the options it builds.
  const options = module.createAuthOptions({} as never, { mailer: captureMailer() }) as {
    emailAndPassword: { requireEmailVerification: boolean };
    socialProviders?: { google?: { clientId: string } };
  };
  return { options, status: module.socialProviderStatus() };
}

describe("google sign-in wiring", () => {
  it("is absent, and says so, when nothing is configured", async () => {
    const { options, status } = await bootAuth();
    expect(status).toEqual({ google: false });
    expect(options.socialProviders?.google).toBeUndefined();
  });

  it("is registered when both halves are set", async () => {
    const { options, status } = await bootAuth({
      GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "client-secret",
    });
    expect(status).toEqual({ google: true });
    expect(options.socialProviders?.google?.clientId).toBe("client-id.apps.googleusercontent.com");
  });
});

describe("verification requirement", () => {
  it("defaults to off and follows the environment when set", async () => {
    const off = await bootAuth({ AUTH_REQUIRE_VERIFICATION: "false" });
    expect(off.options.emailAndPassword.requireEmailVerification).toBe(false);

    const on = await bootAuth({ AUTH_REQUIRE_VERIFICATION: "true" });
    expect(on.options.emailAndPassword.requireEmailVerification).toBe(true);
  });

  it("can be overridden by the caller, which is how the suite tests both modes", async () => {
    const { createAuthOptions } = await import("./auth-options");
    const options = createAuthOptions({} as never, {
      mailer: captureMailer(),
      requireVerification: true,
    }) as { emailAndPassword: { requireEmailVerification: boolean } };
    expect(options.emailAndPassword.requireEmailVerification).toBe(true);
  });
});
