// Drop and recreate the public schema, then re-run migrate + seed.
// DEV ONLY. Bails loudly if NODE_ENV=production.

import "dotenv/config";
import { Pool } from "pg";
import { execSync } from "node:child_process";

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("refusing to run reset in production");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must be set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  // Drop both public (app tables) and drizzle (migrations table) so a fresh
  // migrate actually reapplies the schema.
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE;");
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE;");
  await pool.query("CREATE SCHEMA public;");
  await pool.end();

  console.log("schema dropped + recreated");
  execSync("pnpm db:migrate && pnpm db:seed", { stdio: "inherit" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
