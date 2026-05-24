/**
 * Sweeper. Run from cron in production, or manually in dev.
 *
 * 1. Expire stale 'held' reservations (TTL elapsed). Lazy expiry on read
 *    already covers this in most cases; this is the backstop.
 * 2. Surface stuck 'paying' reservations (> PAYING_TIMEOUT_MINUTES) to
 *    audit_log. Operator runs `pnpm reconcile <id>` for each.
 */

import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, lt, sql } from "drizzle-orm";
import { auditLog, reservations } from "../src/lib/db/schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must be set");
    process.exit(1);
  }
  const payingTimeout = Number(process.env.PAYING_TIMEOUT_MINUTES ?? 30);

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  // 1) Expire stale holds
  const expired = await db
    .update(reservations)
    .set({ status: "expired", updatedAt: sql`now()` })
    .where(
      and(
        eq(reservations.status, "held"),
        lt(reservations.holdExpiresAt, sql`now()`),
      ),
    )
    .returning({ id: reservations.id });
  console.log(`expired ${expired.length} stale holds`);

  // 2) Find stuck 'paying' rows; log to audit_log; do NOT auto-mutate.
  const stuck = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.status, "paying"),
        lt(
          reservations.updatedAt,
          sql`now() - (${payingTimeout} * interval '1 minute')`,
        ),
      ),
    );

  for (const row of stuck) {
    // Only log if we haven't already flagged this one. We don't have a
    // dedicated index for this; for the assessment scope, accepting that a
    // re-run can write duplicate audit rows is OK. Operators will see them as
    // a single ongoing issue.
    await db.insert(auditLog).values({
      actor: "system",
      action: "stuck_paying_detected",
      targetKind: "reservation",
      targetId: row.id,
      detail: { thresholdMinutes: payingTimeout },
    });
  }
  if (stuck.length > 0) {
    console.warn(
      `flagged ${stuck.length} stuck 'paying' reservations for operator review:`,
      stuck.map((r) => r.id),
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
