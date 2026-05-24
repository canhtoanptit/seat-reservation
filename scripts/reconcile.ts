/**
 * Operator reconciliation for a stuck reservation.
 *
 * Usage: pnpm reconcile <reservation_id> --outcome=<succeeded|failed|expired>
 *
 * The operator has looked at the provider dashboard and is asserting truth.
 * This script applies the corresponding terminal state to the reservation and
 * writes an audit_log entry citing the operator (taken from $OPERATOR or
 * "manual").
 *
 * In a real system, this would also call the provider to fetch the intent's
 * true status and refuse to mutate state that contradicts it. With the mock,
 * we trust the operator's assertion.
 */

import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { auditLog, payments, reservations } from "../src/lib/db/schema";
import { nextStatus, type TransitionEvent } from "../src/lib/reservation/state";

type Outcome = "succeeded" | "failed" | "expired";

function parseArgs(): { reservationId: string; outcome: Outcome } {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: pnpm reconcile <reservation_id> --outcome=<succeeded|failed|expired>");
    process.exit(2);
  }
  const flag = process.argv.find((a) => a.startsWith("--outcome="));
  const outcome = (flag?.split("=")[1] ?? "") as Outcome;
  if (!["succeeded", "failed", "expired"].includes(outcome)) {
    console.error("--outcome must be one of: succeeded | failed | expired");
    process.exit(2);
  }
  return { reservationId: id, outcome };
}

function outcomeToTransition(o: Outcome): TransitionEvent {
  switch (o) {
    case "succeeded":
      return "reconcile_succeeded";
    case "failed":
      return "reconcile_failed";
    case "expired":
      return "reconcile_expired";
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must be set");
    process.exit(1);
  }
  const { reservationId, outcome } = parseArgs();
  const operator = process.env.OPERATOR ?? "manual";

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .for("update")
      .limit(1);
    if (!row) {
      throw new Error(`reservation ${reservationId} not found`);
    }
    const event = outcomeToTransition(outcome);
    const next = nextStatus(row.status, event);
    if (!next) {
      throw new Error(
        `cannot reconcile a ${row.status} reservation via ${event}`,
      );
    }
    await tx
      .update(reservations)
      .set({ status: next, updatedAt: sql`now()` })
      .where(eq(reservations.id, reservationId));

    // Update the payment row too, if present.
    await tx
      .update(payments)
      .set({
        status:
          outcome === "succeeded"
            ? "succeeded"
            : outcome === "failed"
              ? "failed"
              : "cancelled",
        updatedAt: sql`now()`,
      })
      .where(eq(payments.reservationId, reservationId));

    await tx.insert(auditLog).values({
      actor: operator,
      action: `manual_reconciliation_${outcome}`,
      targetKind: "reservation",
      targetId: reservationId,
      detail: { from: row.status, to: next, operator },
    });

    console.log(`reservation ${reservationId}: ${row.status} → ${next}`);
  });

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
