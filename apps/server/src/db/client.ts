import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import { env } from "../env";
import { schema } from "./schema";

const client = postgres(env.DATABASE_URL);

export const db = drizzle(client, { schema });
export type Database = typeof db;
