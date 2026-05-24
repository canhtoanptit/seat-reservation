# ADR 0005 — Concurrency: hold-then-confirm with TTL

**Status:** Accepted

## Context

Three seats. Multiple users may race for the same seat. There is a **payment step** between selection and confirmation — the user picks a seat, then enters a checkout flow that may succeed, fail, or be abandoned.

Two failure modes we must prevent:

1. **Double-booking.** Two users both end up with confirmed reservations for the same seat. Unacceptable.
2. **Permanent locks.** A user holds a seat but never pays; the seat is stuck "in-progress" forever. Unacceptable.

There is a third failure mode we accept and document:

3. **Held-but-not-confirmed seats appear taken** to other users during the hold window. This is the right UX — better than letting a second user reach the payment page only to find the seat gone.

## Decision

**Hold-then-confirm with a TTL** — the industry-standard pattern used by Ticketmaster, OpenTable, airline GDSes, etc.

A reservation transitions through an explicit FSM (see `diagrams/state-machine.md`):

```
held → paying → confirmed
  ↓       ↓
expired  failed
  ↓
cancelled
```

States `held`, `paying`, and `confirmed` are "active" — they count as occupying the seat.

**Defence in depth, four layers:**

### Layer 1 — Database-enforced invariant (the load-bearing one)

```sql
CREATE UNIQUE INDEX one_active_reservation_per_seat
  ON reservations (seat_id)
  WHERE status IN ('held', 'paying', 'confirmed');
```

At most one active reservation per seat. **Application code cannot violate this.** If logic ever permits a second active row to be inserted, Postgres raises `23505` and the transaction aborts. This is the safety net under everything else.

### Layer 2 — Row-level locking inside the hold transaction

```
BEGIN;
  SELECT * FROM seats WHERE id = $1 FOR UPDATE;           -- serialise on the seat
  UPDATE reservations SET status='expired'
    WHERE seat_id = $1 AND status='held' AND hold_expires_at < now();
  SELECT 1 FROM reservations
    WHERE seat_id = $1 AND status IN ('held','paying','confirmed');
  -- if any row found → ROLLBACK, return SeatUnavailable
  INSERT INTO reservations (seat_id, user_id, status, hold_expires_at)
    VALUES ($1, $2, 'held', now() + interval '10 minutes');
COMMIT;
```

Concurrent transactions for the same seat serialise on the row lock. By the time the second one reads, it sees the first one's reservation.

### Layer 3 — Lazy expiry on read paths

Anywhere we list seats or validate a hold, we first `UPDATE reservations SET status='expired'` for stale `held` rows. This means a held-but-abandoned seat becomes available **at the next read**, not "eventually". The sweeper script is a backstop, not a correctness requirement.

### Layer 4 — Webhook idempotency

`webhook_events (provider, event_id) UNIQUE` means a re-delivered webhook is a no-op. The first delivery transitions `paying → confirmed`; subsequent deliveries return 200 without re-applying the transition.

## Consequences

**Positive**

- Correctness does not depend on application logic being perfect.
- The headline test (`tests/integration/concurrent-hold.test.ts`) **proves** the invariant under parallel load.
- The pattern is familiar to anyone who has worked on a booking system.

**Negative**

- The hold TTL is a user-visible time pressure. 10 minutes feels right for 3 seats; configurable via `HOLD_TTL_MINUTES`.
- `paying` reservations can theoretically be stuck if the provider goes silent. Handled separately as a "stuck-paying" recovery flow with a longer timeout (30 min) and a `reconcile` script. See `operations.md`.

## Alternatives considered

- **Optimistic at payment time only.** Don't hold the seat for anyone; check availability and atomically reserve when payment completes. *Rejected*: bad UX (user pays for a seat someone else just took), and the race window moves into the payment provider's call site rather than disappearing.

- **Distributed lock (Redis SETNX / Redlock).** *Rejected*: single-Postgres `FOR UPDATE` is sufficient and avoids introducing another stateful component. Adds operational complexity without adding safety.

- **`SERIALIZABLE` isolation everywhere.** Heavy hammer. The partial unique index + row-level locks at the right granularity is cheaper and equally safe.

- **Queue-based booking ("get in line for seat A").** Overkill for 3 seats. Would make sense for an event with 10k seats and 100k contenders.
