// Seed the 3 seats. Idempotent: re-running does not create duplicates.

import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { seats } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must be set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  await db
    .insert(seats)
    .values([
      { label: "A1", priceCents: 2500, currency: "EUR" },
      { label: "A2", priceCents: 2500, currency: "EUR" },
      { label: "A3", priceCents: 2500, currency: "EUR" },
    ])
    .onConflictDoNothing({ target: seats.label });

  const result = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM seats`,
  );
  console.log(`seats in DB: ${result.rows[0]?.count ?? 0}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
