/**
 * Integration-test helper. Truncates all app tables to a known empty state and
 * inserts a fixture set if requested.
 */

import { sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  auditLog,
  payments,
  reservations,
  seats,
  sessions,
  users,
  webhookEvents,
  type Seat,
  type User,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";

export async function truncateAll(): Promise<void> {
  // Order matters because of FKs; truncate with CASCADE keeps it simple.
  await db.execute(sql`
    TRUNCATE TABLE
      audit_log,
      webhook_events,
      payments,
      reservations,
      sessions,
      seats,
      users
    RESTART IDENTITY CASCADE;
  `);
}

export async function seedSeats(): Promise<Seat[]> {
  // Test fixture pool. Matches scripts/seed.ts so the dev DB and the test DB
  // look the same shape.
  const labels = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5"];
  return db
    .insert(seats)
    .values(labels.map((label) => ({ label, priceCents: 2500, currency: "EUR" })))
    .returning();
}

export async function createUser(email: string, password = "correct-horse-battery-staple"): Promise<User> {
  const passwordHash = await hashPassword(password);
  const [u] = await db.insert(users).values({ email, passwordHash }).returning();
  if (!u) throw new Error("user insert returned no row");
  return u;
}

export async function closePool(): Promise<void> {
  await pool.end();
}

// Re-export for convenience
export { db, sessions, seats, users, payments, reservations, webhookEvents, auditLog };
