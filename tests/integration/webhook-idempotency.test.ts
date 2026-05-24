/**
 * Webhook idempotency: the same signed event delivered N times causes the FSM
 * transition to occur exactly once.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  closePool,
  createUser,
  db,
  reservations,
  seedSeats,
  truncateAll,
  webhookEvents,
} from "../setup-db";
import { beginPayment, processWebhook } from "@/lib/reservation/payment-service";
import { mockProvider, _resetIntents } from "@/lib/payment/mock-provider";

beforeEach(async () => {
  await truncateAll();
  _resetIntents();
});

afterAll(async () => {
  await closePool();
});

describe("webhook idempotency", () => {
  it("same event delivered 5x transitions reservation exactly once", async () => {
    const seats = await seedSeats();
    const user = await createUser("alice@example.com");

    // Set up a 'paying' reservation via the real beginPayment flow.
    const [{ id: reservationId }] = await db
      .insert(reservations)
      .values({
        seatId: seats[0]!.id,
        userId: user.id,
        status: "held",
        holdExpiresAt: new Date(Date.now() + 10 * 60_000),
      })
      .returning({ id: reservations.id });

    await beginPayment({ reservationId: reservationId!, userId: user.id });

    // Compose a single event referencing the just-created intent.
    const [payment] = await db
      .select()
      .from((await import("@/lib/db/schema")).payments)
      .where(eq((await import("@/lib/db/schema")).payments.reservationId, reservationId!))
      .limit(1);
    expect(payment).toBeTruthy();

    const event = {
      eventId: "evt_dupe_test_1",
      intentId: payment!.providerIntentId,
      type: "payment.succeeded" as const,
      createdAt: new Date().toISOString(),
    };

    // Deliver 5x in parallel.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => processWebhook(mockProvider.providerId, event)),
    );

    // Exactly one ok, the rest duplicate.
    const ok = results.filter((r) => r.kind === "ok");
    const dupe = results.filter((r) => r.kind === "duplicate");
    expect(ok.length).toBe(1);
    expect(dupe.length).toBe(4);

    // DB shows the reservation confirmed and one webhook_events row.
    const [resAfter] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId!))
      .limit(1);
    expect(resAfter!.status).toBe("confirmed");

    const events = await db.select().from(webhookEvents);
    expect(events.length).toBe(1);
  });
});
