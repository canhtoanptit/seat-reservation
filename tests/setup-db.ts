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
  return db
    .insert(seats)
    .values([
      { label: "A1", priceCents: 2500, currency: "EUR" },
      { label: "A2", priceCents: 2500, currency: "EUR" },
      { label: "A3", priceCents: 2500, currency: "EUR" },
    ])
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
