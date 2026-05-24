import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ACTIVE_RESERVATION_STATUSES,
  reservations,
  seats,
  type Reservation,
  type Seat,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  HoldExpired,
  IllegalState,
  NotYourReservation,
  ReservationNotFound,
  SeatNotFound,
  SeatUnavailable,
} from "./errors";

export type SeatWithAvailability = Seat & {
  activeReservation: {
    id: string;
    userId: string;
    status: Reservation["status"];
  } | null;
};

/**
 * List all seats with their current availability. Lazy-expires stale holds
 * inline so abandoned holds free up the seat immediately on this read.
 */
export async function listSeats(): Promise<SeatWithAvailability[]> {
  await expireStaleHolds();

  const rows = await db
    .select({
      seat: seats,
      reservationId: reservations.id,
      reservationUserId: reservations.userId,
      reservationStatus: reservations.status,
    })
    .from(seats)
    .leftJoin(
      reservations,
      and(
        eq(reservations.seatId, seats.id),
        inArray(reservations.status, [...ACTIVE_RESERVATION_STATUSES]),
      ),
    )
    .orderBy(seats.label);

  return rows.map((r) => ({
    ...r.seat,
    activeReservation: r.reservationId
      ? {
          id: r.reservationId,
          userId: r.reservationUserId!,
          status: r.reservationStatus!,
        }
      : null,
  }));
}

/**
 * Expire stale held / paying reservations. Held reservations whose TTL has
 * passed are marked expired. Paying reservations beyond the longer timeout
 * are NOT mutated here — they're flagged for operator review by the sweeper.
 */
export async function expireStaleHolds(): Promise<number> {
  const result = await db
    .update(reservations)
    .set({ status: "expired", updatedAt: sql`now()` })
    .where(
      and(
        eq(reservations.status, "held"),
        lt(reservations.holdExpiresAt, sql`now()`),
      ),
    );
  // Drizzle's update result varies by driver; node-postgres returns rowCount.
  return (result as unknown as { rowCount: number }).rowCount ?? 0;
}

/**
 * Create a hold on a seat for a user.
 *
 * The headline transactional flow:
 *   BEGIN
 *     SELECT seat FOR UPDATE       -- serialise concurrent holds on this seat
 *     UPDATE stale 'held' → 'expired' for this seat
 *     check no active reservation exists
 *     INSERT reservation (held, expires_at = now() + HOLD_TTL_MINUTES)
 *   COMMIT
 *
 * Safety net: the partial unique index will reject a second active row even
 * if the application-level check is wrong. We map 23505 to SeatUnavailable.
 */
export async function createHold(args: {
  seatId: string;
  userId: string;
}): Promise<Reservation> {
  const { seatId, userId } = args;

  try {
    return await db.transaction(async (tx) => {
      // 1) Lock the seat row. Concurrent calls for the same seat serialise here.
      const seatRows = await tx
        .select()
        .from(seats)
        .where(eq(seats.id, seatId))
        .for("update")
        .limit(1);
      const seat = seatRows[0];
      if (!seat) throw new SeatNotFound();

      // 2) Inside the lock, lazy-expire stale held rows for this seat.
      await tx
        .update(reservations)
        .set({ status: "expired", updatedAt: sql`now()` })
        .where(
          and(
            eq(reservations.seatId, seatId),
            eq(reservations.status, "held"),
            lt(reservations.holdExpiresAt, sql`now()`),
          ),
        );

      // 3) Check no active reservation exists.
      const active = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.seatId, seatId),
            inArray(reservations.status, [...ACTIVE_RESERVATION_STATUSES]),
          ),
        )
        .limit(1);
      if (active.length > 0) throw new SeatUnavailable();

      // 4) Insert the new hold.
      const holdExpiresAt = new Date(
        Date.now() + env.HOLD_TTL_MINUTES * 60 * 1000,
      );
      const [created] = await tx
        .insert(reservations)
        .values({
          seatId,
          userId,
          status: "held",
          holdExpiresAt,
        })
        .returning();
      if (!created) throw new Error("INSERT returned no row");
      return created;
    });
  } catch (err: unknown) {
    // Safety net: the partial unique index caught a race the application
    // missed. Map to SeatUnavailable so callers handle one error type.
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      logger.warn(
        { seatId, userId },
        "partial unique index caught a hold race (application check missed)",
      );
      throw new SeatUnavailable();
    }
    throw err;
  }
}

/**
 * Cancel a held reservation. Must belong to the user and be in 'held' state.
 */
export async function cancelHold(args: {
  reservationId: string;
  userId: string;
}): Promise<void> {
  const { reservationId, userId } = args;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .for("update")
      .limit(1);
    if (!row) throw new ReservationNotFound();
    if (row.userId !== userId) throw new NotYourReservation();
    if (row.status !== "held") throw new IllegalState(`cannot cancel ${row.status}`);

    await tx
      .update(reservations)
      .set({ status: "cancelled", updatedAt: sql`now()` })
      .where(eq(reservations.id, reservationId));
  });
}

/**
 * Load a reservation owned by the user, with the seat joined.
 */
export async function getOwnReservation(args: {
  reservationId: string;
  userId: string;
}): Promise<{ reservation: Reservation; seat: Seat }> {
  const [row] = await db
    .select({ reservation: reservations, seat: seats })
    .from(reservations)
    .innerJoin(seats, eq(seats.id, reservations.seatId))
    .where(eq(reservations.id, args.reservationId))
    .limit(1);
  if (!row) throw new ReservationNotFound();
  if (row.reservation.userId !== args.userId) throw new NotYourReservation();
  return row;
}

/**
 * Assert a reservation is currently a valid 'held' (not expired). Used by
 * beginPayment to fail fast before talking to the provider.
 */
export function assertValidHold(reservation: Reservation): void {
  if (reservation.status !== "held") {
    throw new IllegalState(`not a held reservation (status=${reservation.status})`);
  }
  if (
    reservation.holdExpiresAt &&
    reservation.holdExpiresAt.getTime() < Date.now()
  ) {
    throw new HoldExpired();
  }
}
