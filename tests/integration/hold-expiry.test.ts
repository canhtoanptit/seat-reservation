/**
 * Hold expiry: a held reservation whose hold_expires_at is in the past must
 * be lazily expired by listSeats. Proves correctness without depending on the
 * sweeper script.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { listSeats } from "@/lib/reservation/service";
import {
  closePool,
  createUser,
  db,
  reservations,
  seedSeats,
  truncateAll,
} from "../setup-db";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closePool();
});

describe("lazy hold expiry on listSeats", () => {
  it("expires a stale held reservation when listing", async () => {
    const seats = await seedSeats();
    const user = await createUser("alice@example.com");

    const [created] = await db
      .insert(reservations)
      .values({
        seatId: seats[0]!.id,
        userId: user.id,
        status: "held",
        holdExpiresAt: new Date(Date.now() - 60_000), // 1 min in the past
      })
      .returning();

    const listed = await listSeats();
    const targetSeat = listed.find((s) => s.id === seats[0]!.id)!;
    expect(targetSeat.activeReservation).toBeNull();

    const [reread] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, created!.id))
      .limit(1);
    expect(reread!.status).toBe("expired");
  });

  it("leaves a non-stale held reservation alone", async () => {
    const seats = await seedSeats();
    const user = await createUser("alice@example.com");

    await db.insert(reservations).values({
      seatId: seats[0]!.id,
      userId: user.id,
      status: "held",
      holdExpiresAt: new Date(Date.now() + 5 * 60_000),
    });

    const listed = await listSeats();
    const targetSeat = listed.find((s) => s.id === seats[0]!.id)!;
    expect(targetSeat.activeReservation?.status).toBe("held");
  });
});
