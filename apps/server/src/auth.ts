import { betterAuth } from "better-auth";

import { createAuthOptions } from "./auth-options";
import { db } from "./db/client";

export const auth = betterAuth(createAuthOptions(db));

export const getSessionFromHeaders = (headers: Headers) => auth.api.getSession({ headers });
