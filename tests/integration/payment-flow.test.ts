/**
 * Payment flow: held → paying → confirmed (happy path) and held → paying →
 * failed. Exercises beginPayment + processWebhook against the real DB.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  closePool,
  createUser,
  db,
  payments,
  reservations,
  seedSeats,
  truncateAll,
} from "../setup-db";
import { beginPayment, processWebhook } from "@/lib/reservation/payment-service";
import { _resetIntents, mockProvider } from "@/lib/payment/mock-provider";

beforeEach(async () => {
  await truncateAll();
  _resetIntents();
});

afterAll(async () => {
  await closePool();
});

async function setupHeld() {
  const seats = await seedSeats();
  const user = await createUser("alice@example.com");
  const [r] = await db
    .insert(reservations)
    .values({
      seatId: seats[0]!.id,
      userId: user.id,
      status: "held",
      holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    })
    .returning();
  return { seat: seats[0]!, user, reservationId: r!.id };
}

describe("payment flow", () => {
  it("held → paying → confirmed on payment.succeeded", async () => {
    const { reservationId, user } = await setupHeld();
    await beginPayment({ reservationId, userId: user.id });

    const [p] = await db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, reservationId))
      .limit(1);
    expect(p).toBeTruthy();

    await processWebhook(mockProvider.providerId, {
      eventId: "evt_succ_1",
      intentId: p!.providerIntentId,
      type: "payment.succeeded",
      createdAt: new Date().toISOString(),
    });

    const [r] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .limit(1);
    expect(r!.status).toBe("confirmed");

    const [pAfter] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, p!.id))
      .limit(1);
    expect(pAfter!.status).toBe("succeeded");
  });

  it("held → paying → failed on payment.failed; seat is released", async () => {
    const { reservationId, user, seat } = await setupHeld();
    await beginPayment({ reservationId, userId: user.id });

    const [p] = await db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, reservationId))
      .limit(1);

    await processWebhook(mockProvider.providerId, {
      eventId: "evt_fail_1",
      intentId: p!.providerIntentId,
      type: "payment.failed",
      createdAt: new Date().toISOString(),
    });

    const [r] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .limit(1);
    expect(r!.status).toBe("failed");

    // Seat is now free for a new hold.
    const { createHold } = await import("@/lib/reservation/service");
    const otherUser = await createUser("bob@example.com");
    const newHold = await createHold({ seatId: seat.id, userId: otherUser.id });
    expect(newHold.status).toBe("held");
  });

  it("beginPayment on an expired hold throws HoldExpired", async () => {
    const seats = await seedSeats();
    const user = await createUser("alice@example.com");
    const [r] = await db
      .insert(reservations)
      .values({
        seatId: seats[0]!.id,
        userId: user.id,
        status: "held",
        holdExpiresAt: new Date(Date.now() - 60_000), // expired
      })
      .returning();

    const { HoldExpired } = await import("@/lib/reservation/errors");
    await expect(
      beginPayment({ reservationId: r!.id, userId: user.id }),
    ).rejects.toBeInstanceOf(HoldExpired);
  });
});
