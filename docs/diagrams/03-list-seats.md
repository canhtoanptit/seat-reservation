# List seats (with lazy hold expiry)

The seats page is the most-hit read path. It does two things people often forget:

1. **Bumps `last_used_at` on the session** so sliding-window expiry works.
2. **Lazy-expires stale holds** so abandoned holds free up the seat immediately on the next read, not "eventually after the sweeper runs".

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant Web as Next.js (RSC)
    participant DB as Postgres

    U->>Web: GET /seats (cookie session=<token>)
    Web->>DB: SELECT * FROM sessions\n WHERE id = sha256(token)\n  AND expires_at > now()\n  AND last_used_at > now() - interval '90 days'
    DB-->>Web: session or null
    alt not authed
        Web-->>U: 302 /login
    else authed
        Web->>DB: UPDATE sessions SET last_used_at = now() WHERE id = ?
        Web->>DB: UPDATE reservations\n  SET status='expired', updated_at=now()\n WHERE status='held' AND hold_expires_at < now()
        Web->>DB: SELECT s.id, s.label, s.price_cents, s.currency,\n       r.id AS reservation_id, r.user_id, r.status\n  FROM seats s\n  LEFT JOIN reservations r\n    ON r.seat_id = s.id\n   AND r.status IN ('held','paying','confirmed')
        DB-->>Web: 3 rows
        Web-->>U: render /seats with availability + per-seat CTA
    end
```

## Why lazy expiry on every read

If you only expire holds via a periodic sweeper, an abandoned hold blocks the seat until the next sweeper tick. At this scale that's user-visible. Doing the `UPDATE` on every read costs almost nothing (the partial index `reservations_hold_expiry_idx` covers it) and gives users immediate availability.

The sweeper still exists — it's the backstop that handles seats no-one is currently looking at, and it surfaces stuck-`paying` reservations for operator attention.

## Why bumping `last_used_at` is on the request path

Per ADR 0004, the session is valid iff `now < expires_at` **and** `now - last_used_at < 90d`. Bumping `last_used_at` per authenticated request implements the sliding window. The cost is one `UPDATE` per page load; for this scope, acceptable. At scale we'd move it off the request path (write-behind queue with debouncing).
