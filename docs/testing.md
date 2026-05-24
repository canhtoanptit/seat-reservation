# Testing strategy

Tests are written to **prove the load-bearing invariants** of the system, not to maximise coverage of glue code. The headline integration test (`concurrent-hold.test.ts`) is the most important file in the repo for an evaluator — it directly demonstrates the no-double-booking property.

## Layers

### Unit (Vitest, no DB)

Pure-logic tests. Fast feedback. No fixtures.

- **`tests/unit/reservation-state.test.ts`** — every legal transition is legal; every illegal transition is illegal. Table-driven. The FSM in `src/lib/reservation/state.ts` is a pure module so this is straightforward.
- **`tests/unit/hmac.test.ts`** — sign / verify round-trip; tampered payload fails; wrong secret fails; constant-time comparison (no early return for shared prefix length).
- **`tests/unit/rate-limit.test.ts`** — token bucket exhausts; resets on success; per-IP and per-email counters are independent; lazy eviction works.
- **`tests/unit/password.test.ts`** — hash + verify round-trip; verify against dummy hash on unknown user takes comparable time (assertion is "no early return", not a precise wall-clock measurement).

### Integration (Vitest + real Postgres via Docker Compose)

Truth-tellers. Each test sets up a fresh schema in a transaction that is rolled back at the end, or uses a unique schema name per test file.

- **`tests/integration/concurrent-hold.test.ts` — THE headline test.**
  - Setup: a single seat, two users, fresh DB.
  - Action: spawn N=10 calls to `createHold` for that seat in `Promise.all`.
  - Assertions:
    - Exactly one promise resolves successfully.
    - The other nine reject with `SeatUnavailable`.
    - Exactly one row in `reservations` has `status='held'` for that seat.
    - The Postgres logs (or driver error count) show **zero** 23505 errors — meaning the partial unique index was the safety net but the application's check carried the actual load. (If the test starts seeing 23505s, that's a regression we'd want to know about.)

- **`tests/integration/webhook-idempotency.test.ts`**
  - Setup: a `paying` reservation with an associated payment intent.
  - Action: POST the same signed event 5 times in parallel to `/api/webhooks/payment`.
  - Assertions:
    - The reservation is `confirmed` exactly once.
    - Exactly one row in `webhook_events` for that `event_id`.
    - All 5 responses are 200.

- **`tests/integration/webhook-signature.test.ts`**
  - Sign with the wrong secret → 401, `audit_log` row written.
  - Truncated signature → 401.
  - Missing signature header → 401.
  - Valid signature, malformed body → 400.

- **`tests/integration/hold-expiry.test.ts`**
  - Setup: a `held` reservation with `hold_expires_at` 60 s in the past.
  - Action: call `listSeats`.
  - Assertions:
    - The original reservation is now `status='expired'`.
    - The seat appears available in the result.

- **`tests/integration/session-sliding-window.test.ts`**
  - Four scenarios, table-driven:
    | created_at | last_used_at | valid? |
    |---|---|---|
    | 1 day ago | 1 hour ago | yes |
    | 89 days ago | 1 day ago | yes |
    | 5 days ago | 91 days ago | no (inactivity) |
    | 91 days ago | 1 day ago | no (absolute cap) |

- **`tests/integration/payment-flow.test.ts`**
  - Happy path: user → hold → begin payment → webhook `payment.succeeded` → reservation is `confirmed`.
  - Failed path: same, but webhook `payment.failed` → reservation is `failed`, seat is released.
  - Hold-expired-then-pay: a hold whose TTL elapsed before payment is rejected at `beginPayment`.

### End-to-end (Playwright, one spec)

Smoke-level, not exhaustive.

- **`tests/e2e/happy-path.spec.ts`**
  - Sign up → log in → see 3 available seats → click Reserve on the first one → land on /reservations/[id] → click Pay → land on /mock-pay/[intentId] → click Succeed → confirmation page → navigate to /seats and assert the reserved seat appears under "Your reservations".

That's the only E2E. The integration tests carry the correctness load; Playwright just proves the UI is wired end-to-end.

## Running

```bash
# Unit + integration (requires docker compose up -d for Postgres)
pnpm test

# Integration only
pnpm test tests/integration

# E2E (requires the dev server running — Playwright is configured to start it)
pnpm test:e2e

# Watch mode for unit
pnpm test:watch
```

CI is not configured for this submission (out of scope), but `pnpm test` runs cleanly against a Compose-launched Postgres, so a CI step would be:

```yaml
# illustrative, not committed
services:
  postgres:
    image: postgres:16
    env: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: seat_reservation }
steps:
  - run: pnpm install --frozen-lockfile
  - run: pnpm db:migrate && pnpm db:seed
  - run: pnpm typecheck
  - run: pnpm lint
  - run: pnpm test
```

## What we are deliberately not testing

- UI layout, pixel snapshots, mobile responsive — out of scope; the markup is simple Tailwind utility classes.
- ARIA / accessibility automation — would add `axe-core` in CI. Out of scope.
- Localisation — single locale.
- Every error message string — flaky, not behaviour-relevant.
- Real Stripe — the mock provider exercises the same shape; swapping in Stripe would warrant its own contract tests.
- Load / soak testing — the integration concurrent-hold test exercises the safety property in-process; a load test would exercise the same path over real HTTP. We document this as a follow-up in `trade-offs.md`.

## How to read a test failure

- **`concurrent-hold` flakes or fails with > 1 success.** This is a regression in the hold transaction. Check: is `FOR UPDATE` still in the SQL? Is the partial unique index still present? Is the transaction's isolation level being silently downgraded?
- **`webhook-idempotency` shows the FSM transitioning twice.** The idempotency check is broken. Look at `webhook_events` UNIQUE behaviour; look at whether the `processed_at` update is inside the same transaction.
- **`session-sliding-window` fails on the boundary cases.** Either `expires_at` or `last_used_at` is being computed wrong, or the test's clock injection isn't reaching the session module.
- **`hold-expiry` shows the seat still taken.** The lazy-expire `UPDATE` is missing from the read path.
