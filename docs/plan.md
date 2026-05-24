# Implementation plan (reviewer entry-point)

This is the doc to read first. It is short on purpose; the supporting material (ADRs, schema, diagrams) is linked where each topic comes up.

---

## 1. The problem, and what's interesting about it

A public site shows **three seats**. Authenticated users may select one, pay, and confirm a reservation. Sessions last 90 days. The payment provider may be mocked.

The interesting engineering problem is **not** the UI or auth. It's that a payment step sits inside the reservation flow, so a naïve "check then insert" can be raced under concurrent load — two users could both pay for the same seat. Everything in this submission is shaped around making that impossible, and proving it is impossible.

## 2. Architecture at a glance

A single Next.js 15 (App Router) app, backed by PostgreSQL 16. A mock payment "provider" lives inside the same Next.js app as a route group, but is treated like an external service over an HTTP webhook boundary (separate URL, HMAC-signed payload, idempotency keyed). The integration code reads as if it were Stripe; swapping in real Stripe is a single adapter change.

```
┌─────────────────────────────────────────────┐
│  Next.js app                                │
│  ┌──────────────┐   ┌────────────────────┐  │
│  │ Public pages │   │ Mock payment       │  │
│  │ + auth       │   │ "provider"         │  │
│  │ + reserve UI │   │ /mock-pay/[intent] │  │
│  └──────┬───────┘   └─────────┬──────────┘  │
│         │  Server Actions     │ POST webhook │
│         ▼                     ▼             │
│  ┌──────────────────────────────────────┐   │
│  │ Domain layer (TS)                    │   │
│  │   auth · reservation FSM · payments  │   │
│  └────────────────┬─────────────────────┘   │
└───────────────────┼─────────────────────────┘
                    ▼
              PostgreSQL 16
```

See `adr/0001-framework-nextjs-app-router.md`, `adr/0002-database-postgresql.md`, `adr/0006-payment-in-repo-mock.md`.

## 3. State machine and invariants

A reservation moves through a small FSM (`diagrams/state-machine.md`):

```
held → paying → confirmed
  ↓       ↓
expired  failed
  ↓
cancelled
```

"Active" (i.e. the seat is taken) means `held`, `paying`, or `confirmed`. Three primitives keep the invariant safe under concurrency:

- **Partial unique index** on `reservations (seat_id) WHERE status IN ('held','paying','confirmed')` — the load-bearing guard, enforced by the database. Application bugs cannot violate it. See `schema.sql`.
- **`SELECT … FOR UPDATE`** on the seat row inside the hold-creation transaction. Serialises concurrent holds on the same seat.
- **Lazy expiry on every read path**, plus a sweeper script as a backstop. Holds don't outlive their TTL.

Defence in depth, in that order. See `adr/0005-concurrency-hold-then-confirm.md`, `diagrams/04-create-hold-concurrent.md`.

## 4. Auth model

- Email + password (argon2id), 90-day session.
- Cookie carries an opaque token (`HttpOnly; SameSite=Lax; Secure` in prod). The DB stores `sha256(token)`, not the token itself — a DB-only breach does not yield session takeover.
- "90 days" interpreted as **sliding window**: session ends at the earlier of absolute 90 days from creation or 90 days of inactivity. Documented assumption.
- Rate limit on login by IP and by email separately; argon2 verify runs against a dummy hash on unknown users to mask timing.
- CSRF: Server Actions get Origin/Host enforcement from Next.js by default; no custom token machinery.

See `adr/0004-auth-hand-rolled-sessions.md`, `diagrams/01-signup.md`, `diagrams/02-login.md`.

## 5. Payment integration

A mock provider shaped exactly like Stripe:

1. `POST /api/mock-pay/intents` returns `{ id, client_url }`.
2. The user is redirected to `/mock-pay/[intentId]` — a page with **Succeed / Fail / Cancel** buttons.
3. The mock POSTs an HMAC-signed event to `/api/webhooks/payment`.
4. The webhook handler verifies HMAC, inserts into `webhook_events (provider, event_id)` (UNIQUE) for inbound idempotency, then advances the FSM under a transaction with `FOR UPDATE` on payment and reservation rows.

The app side talks to a `PaymentProvider` interface; swapping in real Stripe is an adapter change. See `adr/0006-payment-in-repo-mock.md`, `diagrams/05-begin-payment.md`, `diagrams/06-webhook-confirm.md`.

## 6. Layout of the repo

```
src/
  app/                     — pages, server actions, API routes
    (auth)/login,signup
    seats/
    reservations/[id]/
    mock-pay/[intentId]/
    api/webhooks/payment/
    api/mock-pay/intents/
    api/health/
    actions/               — server actions (auth, reservation)
  lib/
    env.ts                 — Zod-validated env, fail-fast on boot
    logger.ts              — pino
    db/                    — Drizzle schema + client + migrations
    auth/                  — password, session, rate-limit
    reservation/           — FSM + service + errors
    payment/               — provider interface + mock + webhook
scripts/                   — seed, sweep-expired, reconcile
tests/
  unit/                    — pure logic
  integration/             — real Postgres (Docker Compose)
  e2e/                     — Playwright, one happy-path spec
docs/                      — this folder
docker-compose.yml         — Postgres only
```

## 7. How to run (also in the root README)

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Open two private browser windows, sign up two users, both try to reserve seat A1 — one wins, one sees "Seat unavailable". Winner pays; other window refreshes and sees A1 confirmed.

## 8. Out of scope (and why)

Pulled from `trade-offs.md`. The headline items:

- No Redis, no queue, no WebSockets — single Postgres with `FOR UPDATE` + partial unique index is sufficient at this scale.
- No real Stripe — accountless, network-free; the mock is Stripe-shaped so the swap is trivial.
- No OAuth / MFA / magic links / email confirmation — not in spec.
- No public deployment — spec says "locally". README documents Vercel + Neon as the cloud path.
- No CI pipeline — would be GitHub Actions running lint + typecheck + Vitest against a Postgres service container.

See `trade-offs.md` for the full table and what we'd do differently with more time.

## 9. Where to look first (if you only have 10 minutes)

Ranked:

1. **`src/lib/reservation/service.ts`** — the hold transaction and the state transitions. The whole correctness story is here.
2. **`src/app/api/webhooks/payment/route.ts`** — webhook with HMAC verify, idempotency, FSM transition under a transaction.
3. **`tests/integration/concurrent-hold.test.ts`** — the proof that the invariant holds under parallel load.
4. **`docs/adr/0005-concurrency-hold-then-confirm.md`** — the *why*.
5. **`docs/schema.sql`** — the partial unique index that makes everything safe.
