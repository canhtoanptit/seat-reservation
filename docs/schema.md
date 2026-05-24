# Schema rationale

The canonical DDL is `schema.sql`. This doc explains the choices that aren't obvious from reading the SQL.

## Per-table reasoning

### `users`

- **`email` is `citext`**, not `text`. Emails are case-insensitive in practice; using citext means we don't have to remember to lowercase on every read and write. Defence against a class of bugs.
- **`password_hash`** is whatever argon2id outputs (encoded string including the params). We don't store salt separately — argon2 embeds it.

### `sessions`

- **`id` stores `sha256(token)` in hex**, not the raw token. The cookie carries the raw token; the DB stores the hash. A DB-only breach (no app secret leak) does not yield session takeover. This is cheap defence in depth.
- **Two clocks**: `expires_at` is the absolute 90-day cap from creation; `last_used_at` enables a sliding window. The requirement says "90 days" without specifying which. Documented interpretation: a session is valid iff `now < expires_at` **and** `now - last_used_at < 90d`. Either bound being exceeded ends the session.
- **`ON DELETE CASCADE`** on `user_id`: deleting a user invalidates their sessions.

### `seats`

- **`label` is unique** so we can refer to seats by human label in tests/seeds without depending on UUIDs.
- **`price_cents` + `currency`** instead of a single `price` field — money should never be floats; storing minor units sidesteps the entire class of rounding bugs.

### `reservations`

- **`reservation_status` is an enum**, not a free-form string. Illegal states are unrepresentable in the type system at the SQL layer. The Drizzle TS type mirrors it.
- **`hold_expires_at` is nullable**: it's only meaningful while `status IN ('held','paying')`. Once a reservation reaches a terminal state the value becomes historical and possibly misleading. We could keep it always set; nullable lets us not lie about what the value means.
- **Partial unique index** `one_active_reservation_per_seat` is the load-bearing invariant:

  ```sql
  CREATE UNIQUE INDEX one_active_reservation_per_seat
    ON reservations (seat_id)
    WHERE status IN ('held', 'paying', 'confirmed');
  ```

  At most one active reservation per seat, **enforced by the database**. Application code can have bugs; this index ensures the seat can never be sold twice. Combined with `SELECT … FOR UPDATE` inside the hold-creation transaction, it gives correctness defence in depth.

  Why not full unique on `(seat_id)`? Because we want history: many `expired` / `cancelled` / `failed` rows are fine and useful. The partial index is exactly the right shape.

- **`reservations_hold_expiry_idx`** is a partial index supporting the sweeper's predicate efficiently.

### `payments`

- **`reservation_id UNIQUE`**: at most one payment per reservation. The current implementation creates exactly one intent per reservation; if we ever need retry-after-failure with a new intent, we'd relax this and add a `superseded_by` column.
- **`provider_intent_id UNIQUE`**: lookup key from incoming webhook payloads.
- **`idempotency_key UNIQUE`**: lets us safely retry "create intent" on transient failures without spawning duplicate intents at the provider.
- **`status` enum** includes `cancelled` for user-cancelled flows.

### `webhook_events`

- **`(provider, event_id) UNIQUE`** is the inbound idempotency surface. The handler does `INSERT … ON CONFLICT DO NOTHING`; if `rowCount === 0`, the event was already processed and the handler 200-OKs without further work.
- **`processed_at` nullable**: lets us distinguish "received but mid-processing" from "fully processed", useful for recovery.

### `audit_log`

- One table, jsonb `detail`. Deliberately minimal for the assessment scope. Real systems have richer audit (immutable append-only logs, separate streams per concern). This is a hook to make the concern visible.

## Database-enforced invariants (the things bugs cannot violate)

1. **At most one active reservation per seat** — `one_active_reservation_per_seat`.
2. **At most one payment per reservation** — `payments.reservation_id UNIQUE`.
3. **Webhook events deduplicated** — `webhook_events (provider, event_id) UNIQUE`.
4. **At most one outstanding create-intent per idempotency key** — `payments.idempotency_key UNIQUE`.
5. **Money is positive** — `CHECK (price_cents > 0)`, `CHECK (amount_cents > 0)`.
6. **Currency is a 3-letter code** — `CHECK (length(currency) = 3)`.
7. **Reservation status is one of the enum values** — `reservation_status` enum type.
8. **Foreign-key integrity** — `seat_id`, `user_id`, `reservation_id`.

The application is responsible for honouring the FSM transition rules and the hold TTL; the database is responsible for everything above. The integration test `tests/integration/concurrent-hold.test.ts` exists to prove the app and DB together never violate invariant (1).
