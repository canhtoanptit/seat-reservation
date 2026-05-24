import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

declare global {
  var __seatReservationPool: Pool | undefined;
}

// Single pool per process. In Next.js dev mode the module is re-evaluated on
// file change; the global cache avoids leaking connections on every reload.
const pool =
  global.__seatReservationPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  });

if (env.NODE_ENV !== "production") {
  global.__seatReservationPool = pool;
}

export const db = drizzle(pool, { schema, casing: "snake_case" });
export { pool };
export type Database = typeof db;
