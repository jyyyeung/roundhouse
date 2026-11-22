import type { Context } from "hono";

/**
 * Which address the auth rate limiter should count against.
 *
 * better-auth keys its limiter on `x-forwarded-for`, which any client can send.
 * Trusting it by default means an attacker gets a fresh bucket per request by
 * changing one header — a limit that only looks like one. So the header is
 * rewritten from the connection itself unless the deployment says a proxy sits
 * in front (`TRUST_PROXY=true`), and even then the proxy must *overwrite* the
 * header (see `apps/web/nginx.conf`), not append to the client's value.
 */

export type ClientIpInput = {
  /** Raw `x-forwarded-for` header, if the request carried one at all. */
  forwardedFor?: string | null;
  /** Address of the peer that actually opened the connection. */
  remoteAddress?: string | null;
  trustProxy: boolean;
};

/** Strip an optional port and surrounding whitespace: `1.2.3.4:5678` → `1.2.3.4`. */
function normalizeAddress(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  // [::1]:443 → ::1
  const bracketed = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1] ?? null;
  // 1.2.3.4:5678 → 1.2.3.4
  const ipv4 = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (ipv4) return ipv4[1] ?? null;
  // A bare IPv6 address, colon groups and all. Proxies do not append ports here.
  const [address] = trimmed.split("%");
  return address && address !== "" ? address : null;
}

export function resolveClientIp(input: ClientIpInput): string | null {
  if (input.trustProxy && input.forwardedFor) {
    // Leftmost entry is the original client when the edge overwrites the header,
    // which is what the shipped nginx config does.
    const [first] = input.forwardedFor.split(",");
    const forwarded = first ? normalizeAddress(first) : null;
    if (forwarded) return forwarded;
  }
  return input.remoteAddress ? normalizeAddress(input.remoteAddress) : null;
}

/**
 * Returns a request whose `x-forwarded-for` is the address we resolved, so
 * better-auth's limiter cannot be steered by the inbound header.
 */
export function withClientIp(request: Request, ip: string | null): Request {
  if (!ip) return request;
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-for", ip);
  return new Request(request, { headers });
}

/**
 * The peer address of the underlying socket. `getConnInfo` throws when the app
 * is driven through `app.request()` (tests) or any non-node adapter, so a
 * missing address degrades to "unknown" rather than a crash.
 */
export async function remoteAddressOf(c: Context): Promise<string | null> {
  try {
    const { getConnInfo } = await import("@hono/node-server/conninfo");
    const info = getConnInfo(c);
    return info.remote.address ?? null;
  } catch {
    return null;
  }
}
