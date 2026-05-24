import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// citext: case-insensitive text. Used for emails. Extension created by the migrator.
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const reservationStatus = pgEnum("reservation_status", [
  "held",
  "paying",
  "confirmed",
  "expired",
  "cancelled",
  "failed",
]);

export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    // sha256(token) in hex; the cookie carries the raw token
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export const seats = pgTable("seats", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull().unique(),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => seats.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    status: reservationStatus("status").notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // THE invariant: at most one active reservation per seat.
    // Application bugs cannot violate this.
    uniqueIndex("one_active_reservation_per_seat")
      .on(t.seatId)
      .where(sql`status IN ('held', 'paying', 'confirmed')`),
    index("reservations_user_id_idx").on(t.userId),
    index("reservations_hold_expiry_idx")
      .on(t.holdExpiresAt)
      .where(sql`status IN ('held', 'paying')`),
  ],
);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  reservationId: uuid("reservation_id")
    .notNull()
    .unique()
    .references(() => reservations.id),
  provider: text("provider").notNull(),
  providerIntentId: text("provider_intent_id").notNull().unique(),
  status: paymentStatus("status").notNull().default("pending"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("webhook_events_provider_event_id_idx").on(
      t.provider,
      t.eventId,
    ),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor"),
    action: text("action").notNull(),
    targetKind: text("target_kind"),
    targetId: uuid("target_id"),
    detail: jsonb("detail"),
  },
  (t) => [
    index("audit_log_target_idx").on(t.targetKind, t.targetId),
    index("audit_log_at_idx").on(t.at.desc()),
  ],
);

// Convenience type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Seat = typeof seats.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type ReservationStatus = (typeof reservationStatus.enumValues)[number];
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];

export const ACTIVE_RESERVATION_STATUSES = [
  "held",
  "paying",
  "confirmed",
] as const satisfies ReadonlyArray<ReservationStatus>;
