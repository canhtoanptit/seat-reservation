import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  payments,
  reservations,
  seats,
  webhookEvents,
  type Payment,
  type Reservation,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { mockProvider } from "@/lib/payment/mock-provider";
import type { PaymentProvider, WebhookEvent } from "@/lib/payment/types";
import {
  HoldExpired,
  IllegalState,
  NotYourReservation,
  ReservationNotFound,
  SeatNotFound,
} from "./errors";
import { nextStatus, type TransitionEvent } from "./state";

/** Provider injection point. Tests can pass a stub PaymentProvider. */
export function getProvider(): PaymentProvider {
  return mockProvider;
}

/**
 * Begin payment: held → paying. Transaction wraps the provider call so a
 * provider failure rolls back the state change. In real Stripe at scale we
 * would move the provider call out of the transaction; documented in
 * docs/diagrams/05-begin-payment.md.
 *
 * Idempotent: re-calling on a reservation that's already 'paying' returns the
 * existing intent's client_url rather than creating a duplicate.
 */
export async function beginPayment(args: {
  reservationId: string;
  userId: string;
  provider?: PaymentProvider;
}): Promise<{ clientUrl: string; paymentId: string }> {
  const provider = args.provider ?? getProvider();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ reservation: reservations, seat: seats })
      .from(reservations)
      .innerJoin(seats, eq(seats.id, reservations.seatId))
      .where(eq(reservations.id, args.reservationId))
      .for("update")
      .limit(1);
    if (!row) throw new ReservationNotFound();
    if (!row.seat) throw new SeatNotFound();

    const { reservation, seat } = row;
    if (reservation.userId !== args.userId) throw new NotYourReservation();

    // Idempotent: if already paying, return existing intent URL.
    if (reservation.status === "paying") {
      const [existing] = await tx
        .select()
        .from(payments)
        .where(eq(payments.reservationId, reservation.id))
        .limit(1);
      if (existing) {
        return {
          clientUrl: `${env.MOCK_PAYMENT_BASE_URL}/mock-pay/${existing.providerIntentId}`,
          paymentId: existing.id,
        };
      }
      throw new IllegalState("paying without a payment row");
    }

    if (reservation.status !== "held") {
      throw new IllegalState(`cannot begin payment from ${reservation.status}`);
    }
    if (
      reservation.holdExpiresAt &&
      reservation.holdExpiresAt.getTime() < Date.now()
    ) {
      throw new HoldExpired();
    }

    const idempotencyKey = randomUUID();
    const intent = await provider.createIntent({
      amountCents: seat.priceCents,
      currency: seat.currency,
      idempotencyKey,
      returnUrl: `${env.MOCK_PAYMENT_BASE_URL}/reservations/${reservation.id}`,
      metadata: { reservationId: reservation.id },
    });

    const [created] = await tx
      .insert(payments)
      .values({
        reservationId: reservation.id,
        provider: provider.providerId,
        providerIntentId: intent.intentId,
        amountCents: seat.priceCents,
        currency: seat.currency,
        idempotencyKey,
      })
      .returning();
    if (!created) throw new Error("INSERT returned no row");

    await tx
      .update(reservations)
      .set({ status: "paying", updatedAt: sql`now()` })
      .where(eq(reservations.id, reservation.id));

    return { clientUrl: intent.clientUrl, paymentId: created.id };
  });
}

type WebhookResult =
  | { kind: "ok"; status: Reservation["status"] }
  | { kind: "duplicate" }
  | { kind: "unknown_intent" }
  | { kind: "illegal_transition"; from: Reservation["status"] };

/**
 * Process a verified webhook event. Idempotent via webhook_events UNIQUE.
 * Returns a structured result so the route handler can pick the response code.
 */
export async function processWebhook(
  providerId: string,
  event: WebhookEvent,
): Promise<WebhookResult> {
  // 1) Idempotency: try to record the event. If already present, this is a duplicate.
  const inserted = await db
    .insert(webhookEvents)
    .values({
      provider: providerId,
      eventId: event.eventId,
      payload: event,
    })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
    .returning({ id: webhookEvents.id });

  if (inserted.length === 0) return { kind: "duplicate" };

  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.providerIntentId, event.intentId),
          eq(payments.provider, providerId),
        ),
      )
      .for("update")
      .limit(1);
    if (!payment) {
      await tx.insert(auditLog).values({
        actor: "webhook",
        action: "webhook_unknown_intent",
        detail: { event },
      });
      // Mark webhook processed so we don't retry it on receive.
      await tx
        .update(webhookEvents)
        .set({ processedAt: sql`now()` })
        .where(
          and(
            eq(webhookEvents.provider, providerId),
            eq(webhookEvents.eventId, event.eventId),
          ),
        );
      return { kind: "unknown_intent" };
    }

    const [reservation] = await tx
      .select()
      .from(reservations)
      .where(eq(reservations.id, payment.reservationId))
      .for("update")
      .limit(1);
    if (!reservation) throw new Error("payment without reservation");

    const transition = mapEventToTransition(event.type);
    const next = nextStatus(reservation.status, transition);
    if (!next) {
      await tx.insert(auditLog).values({
        actor: "webhook",
        action: "webhook_illegal_transition",
        targetKind: "reservation",
        targetId: reservation.id,
        detail: { from: reservation.status, event },
      });
      logger.warn(
        { reservationId: reservation.id, from: reservation.status, event: event.type },
        "illegal webhook transition",
      );
      await tx
        .update(webhookEvents)
        .set({ processedAt: sql`now()` })
        .where(
          and(
            eq(webhookEvents.provider, providerId),
            eq(webhookEvents.eventId, event.eventId),
          ),
        );
      return { kind: "illegal_transition", from: reservation.status };
    }

    const newPaymentStatus = paymentStatusFor(next);

    await tx
      .update(payments)
      .set({ status: newPaymentStatus, updatedAt: sql`now()` })
      .where(eq(payments.id, payment.id));

    await tx
      .update(reservations)
      .set({ status: next, updatedAt: sql`now()` })
      .where(eq(reservations.id, reservation.id));

    await tx
      .update(webhookEvents)
      .set({ processedAt: sql`now()` })
      .where(
        and(
          eq(webhookEvents.provider, providerId),
          eq(webhookEvents.eventId, event.eventId),
        ),
      );

    return { kind: "ok", status: next };
  });
}

function mapEventToTransition(type: WebhookEvent["type"]): TransitionEvent {
  switch (type) {
    case "payment.succeeded":
      return "payment_succeeded";
    case "payment.failed":
      return "payment_failed";
    case "payment.cancelled":
      // cancellation while 'paying' is functionally a failure for us.
      return "payment_failed";
  }
}

function paymentStatusFor(reservationStatus: Reservation["status"]): Payment["status"] {
  switch (reservationStatus) {
    case "confirmed":
      return "succeeded";
    case "failed":
      return "failed";
    case "expired":
    case "cancelled":
      return "cancelled";
    default:
      // 'held' / 'paying' aren't terminal payment outcomes; shouldn't reach here.
      return "pending";
  }
}
