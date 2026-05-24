// Seed the seat inventory. Idempotent: re-running does not create duplicates.
//
// The spec asks the app to "display 3 available seats". We keep an inventory
// larger than 3 so the page can honour that requirement even when some seats
// are held/paying/confirmed. Pool size is intentionally small (10) so all
// seats can be drained in a manual demo if desired.

import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { seats } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

const SEAT_LABELS = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5"];

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
    .values(
      SEAT_LABELS.map((label) => ({
        label,
        priceCents: 2500,
        currency: "EUR",
      })),
    )
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
