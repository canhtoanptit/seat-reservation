# Create hold — concurrent flow (the headline)

This is the diagram that explains the whole correctness story. Two users hit `createHold` for the same seat at the same moment. Exactly one wins.

```mermaid
sequenceDiagram
    autonumber
    actor A as User A
    actor B as User B
    participant Web as Next.js (Server Action)
    participant DB as Postgres

    par A's transaction
        A->>Web: POST /seats/{id}/hold
        Web->>DB: BEGIN
        Web->>DB: SELECT * FROM seats WHERE id={id} FOR UPDATE
        Note over DB: A acquires the row lock on seat {id}
    and B's transaction (concurrent)
        B->>Web: POST /seats/{id}/hold
        Web->>DB: BEGIN
        Web->>DB: SELECT * FROM seats WHERE id={id} FOR UPDATE
        Note over DB: B waits on A's lock
    end

    Web->>DB: (A) UPDATE reservations SET status='expired'\n  WHERE seat_id={id} AND status='held' AND hold_expires_at < now()
    Web->>DB: (A) SELECT 1 FROM reservations\n  WHERE seat_id={id}\n    AND status IN ('held','paying','confirmed') LIMIT 1
    DB-->>Web: (A) no row
    Web->>DB: (A) INSERT INTO reservations\n  (seat_id, user_id, status, hold_expires_at)\n  VALUES ({id}, A, 'held', now() + interval '10 min')
    DB-->>Web: (A) ok
    Web->>DB: (A) COMMIT
    Note over DB: A's row lock released; A's reservation is now visible

    Web->>DB: (B) lock acquired, re-runs the check
    Web->>DB: (B) SELECT 1 FROM reservations WHERE seat_id={id} AND status IN ('held','paying','confirmed')
    DB-->>Web: (B) finds A's reservation
    Web->>DB: (B) ROLLBACK
    Web-->>B: 409 SeatUnavailable

    Note over DB: Safety net — if B's check somehow missed A's row and reached INSERT, the partial unique index "one_active_reservation_per_seat" would raise 23505 and B's transaction would still abort.

    Web-->>A: 302 /reservations/{reservation_id}
```

## Why this is safe

Four layers of safety, top-down:

1. **`SELECT ... FOR UPDATE`** on the seat row serialises the critical section.
2. **The lazy-expire `UPDATE`** inside the transaction handles the case where a previous hold has just timed out: A doesn't lose to a ghost reservation that should already have expired.
3. **The check-then-insert** is the normal path; under `FOR UPDATE` it is race-free.
4. **The partial unique index** is the safety net. Even if (1)–(3) had a bug, the database would refuse the second active row.

## What the test proves

`tests/integration/concurrent-hold.test.ts` spawns N=10 simultaneous calls to `createHold` for the same seat. The assertions:

- Exactly 1 promise resolves; 9 reject with `SeatUnavailable`.
- Exactly 1 reservation exists in active status for that seat.
- The partial unique index error (`23505`) is **not** observed in the logs — meaning the application-level check carried the load and the index was, as intended, just a safety net.
