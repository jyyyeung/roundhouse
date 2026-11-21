import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../env";
import { schema } from "./schema";

const client = postgres(env.DATABASE_URL);

export const db = drizzle(client, { schema });
export type Database = typeof db;

/**
 * Closes the pool during shutdown. The timeout bounds a connection stuck in a
 * query, so a wedged database cannot hold the process open past the deadline.
 */
export function closeDatabase(timeoutSeconds = 5): Promise<void> {
  return client.end({ timeout: timeoutSeconds });
}
