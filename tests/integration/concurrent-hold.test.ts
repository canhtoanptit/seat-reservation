/**
 * THE marquee test. Proves the no-double-booking invariant under parallel load.
 *
 * Spawns N=10 concurrent createHold calls for the same seat. Expects:
 *   - Exactly one to succeed.
 *   - All others to reject with SeatUnavailable.
 *   - Exactly one active reservation row for the seat.
 *
 * If the application-level check ever regresses, the partial unique index is
 * the safety net — but the assertion includes a side-channel check that the
 * 23505 path was not the one that carried the load (failures should be
 * SeatUnavailable, not raw Postgres errors).
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { ACTIVE_RESERVATION_STATUSES, reservations } from "@/lib/db/schema";
import { createHold } from "@/lib/reservation/service";
import { SeatUnavailable } from "@/lib/reservation/errors";
import {
  closePool,
  createUser,
  db,
  seedSeats,
  truncateAll,
} from "../setup-db";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closePool();
});

describe("concurrent createHold for the same seat", () => {
  it("exactly one of N=10 parallel callers wins", async () => {
    const seats = await seedSeats();
    const seat = seats[0]!;

    // Each caller is a different user, so the per-user constraints don't
    // confuse the experiment.
    const users = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createUser(`u${i}@example.com`)),
    );

    const results = await Promise.allSettled(
      users.map((u) => createHold({ seatId: seat.id, userId: u.id })),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(9);

    for (const r of rejected) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason, JSON.stringify(reason)).toBeInstanceOf(SeatUnavailable);
    }

    // Database state: exactly one active reservation for this seat.
    const active = await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.seatId, seat.id),
          inArray(reservations.status, [...ACTIVE_RESERVATION_STATUSES]),
        ),
      );
    expect(active.length).toBe(1);
  });

  it("a winner blocks subsequent calls until they expire or are released", async () => {
    const seats = await seedSeats();
    const seat = seats[0]!;
    const alice = await createUser("alice@example.com");
    const bob = await createUser("bob@example.com");

    await createHold({ seatId: seat.id, userId: alice.id });
    await expect(createHold({ seatId: seat.id, userId: bob.id })).rejects.toBeInstanceOf(
      SeatUnavailable,
    );
  });
});
