import { createAuthClient } from "better-auth/react";

const baseURL =
  import.meta.env.VITE_API_URL ||
  (typeof window === "undefined" ? undefined : window.location.origin);

export const authClient = createAuthClient({
  baseURL,
});
