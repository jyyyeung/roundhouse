import { createAuthClient } from "better-auth/react";

const baseURL =
  import.meta.env.VITE_API_URL ||
  (typeof window === "undefined" ? undefined : window.location.origin);

export const authClient = createAuthClient({
  baseURL,
});

/**
 * Which social providers this server actually configured.
 *
 * The sign-in page asks before it offers a button: an unconfigured provider is
 * a dead end, and the answer lives in the server's environment, not in the
 * build. A network failure reads as "none", which degrades to email sign-in.
 */
export async function googleEnabled(): Promise<boolean> {
  try {
    const response = await fetch(`${baseURL ?? ""}/api/auth/providers`, {
      credentials: "include",
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { google?: unknown } | null;
    return body?.google === true;
  } catch {
    return false;
  }
}
