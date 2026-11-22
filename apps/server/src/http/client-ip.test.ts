import { describe, expect, test } from "vitest";

import { resolveClientIp, withClientIp } from "./client-ip";

/**
 * The key the auth limiter counts against. These assertions are the whole point:
 * a limiter keyed on a client-supplied header is not a limiter.
 */
describe("client ip resolution", () => {
  test("ignores a forwarded header unless a proxy is trusted", () => {
    const key = resolveClientIp({
      forwardedFor: "203.0.113.7",
      remoteAddress: "10.0.0.1",
      trustProxy: false,
    });
    expect(key).toBe("10.0.0.1");
  });

  test("two spoofed headers collapse to one bucket when the proxy is not trusted", () => {
    const first = resolveClientIp({
      forwardedFor: "203.0.113.7",
      remoteAddress: "10.0.0.1",
      trustProxy: false,
    });
    const second = resolveClientIp({
      forwardedFor: "198.51.100.9",
      remoteAddress: "10.0.0.1",
      trustProxy: false,
    });
    expect(first).toBe(second);
  });

  test("reads the forwarded header when the proxy is trusted", () => {
    const key = resolveClientIp({
      forwardedFor: "203.0.113.7",
      remoteAddress: "10.0.0.1",
      trustProxy: true,
    });
    expect(key).toBe("203.0.113.7");
  });

  test("takes the leftmost hop and normalises it", () => {
    expect(
      resolveClientIp({
        forwardedFor: " 203.0.113.7 , 10.0.0.1",
        remoteAddress: "10.0.0.1",
        trustProxy: true,
      }),
    ).toBe("203.0.113.7");
    expect(
      resolveClientIp({ forwardedFor: "203.0.113.7:51000", remoteAddress: null, trustProxy: true }),
    ).toBe("203.0.113.7");
    expect(
      resolveClientIp({
        forwardedFor: "[2001:db8::1]:51000",
        remoteAddress: null,
        trustProxy: true,
      }),
    ).toBe("2001:db8::1");
    expect(
      resolveClientIp({ forwardedFor: "2001:db8::1", remoteAddress: null, trustProxy: true }),
    ).toBe("2001:db8::1");
  });

  test("falls back to the connection when a trusted proxy sent nothing", () => {
    expect(
      resolveClientIp({ forwardedFor: null, remoteAddress: "10.0.0.1", trustProxy: true }),
    ).toBe("10.0.0.1");
    expect(
      resolveClientIp({ forwardedFor: "  ", remoteAddress: "10.0.0.1", trustProxy: true }),
    ).toBe("10.0.0.1");
  });

  test("reports an unknown address as null rather than an empty key", () => {
    expect(resolveClientIp({ forwardedFor: null, remoteAddress: null, trustProxy: true })).toBe(
      null,
    );
  });
});

describe("rewriting the forwarded header", () => {
  test("replaces a spoofed header with the resolved address", () => {
    const request = new Request("http://localhost:3001/api/auth/sign-in/email", {
      headers: { "x-forwarded-for": "203.0.113.7" },
      method: "POST",
    });

    const rewritten = withClientIp(request, "10.0.0.1");
    expect(rewritten.headers.get("x-forwarded-for")).toBe("10.0.0.1");
    // The original request object is left alone; Hono may still be reading it.
    expect(request.headers.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  test("leaves the request untouched when no address could be resolved", () => {
    const request = new Request("http://localhost:3001/api/auth/sign-in/email", {
      headers: { "x-forwarded-for": "203.0.113.7" },
      method: "POST",
    });
    expect(withClientIp(request, null)).toBe(request);
  });
});
