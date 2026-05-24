// Run pending Drizzle migrations. Runs the extension-setup SQL first so the
// schema can use citext and gen_random_uuid().

import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must be set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });

  await pool.query("CREATE EXTENSION IF NOT EXISTS citext;");
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });

  await pool.end();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
