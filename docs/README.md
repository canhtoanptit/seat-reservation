# Documentation index

You probably want **[`plan.md`](./plan.md)** first — it's the 10-minute summary of what this is and the senior-engineering reasoning behind every choice.

## What's in here

```
plan.md            ← start here
schema.sql         full DDL
schema.md          schema rationale + DB-enforced invariants
trade-offs.md      what was deliberately skipped, and why
operations.md      sweeper, reconcile, recovery, env vars
testing.md         test plan; what each test proves

adr/               Architecture Decision Records (one per choice)
  0001  Next.js 15 App Router
  0002  PostgreSQL 16
  0003  Drizzle ORM
  0004  Hand-rolled session auth
  0005  Hold-then-confirm concurrency
  0006  In-repo mock payment provider
  0007  In-memory rate limiting
  0008  Docker Compose for local

diagrams/          Mermaid sequence diagrams
  state-machine             reservation FSM
  01-signup
  02-login                  (with rate-limit branch)
  03-list-seats             (with lazy expiry)
  04-create-hold-concurrent ← the headline flow
  05-begin-payment          (held → paying)
  06-webhook-confirm        (HMAC, idempotency, FSM transition)
  07-hold-expiry            (lazy + sweeper)
```

## Reading order for an evaluator

If you have **10 minutes**, read in this order:

1. `plan.md` — the whole story in one page
2. `diagrams/state-machine.md` — the FSM
3. `diagrams/04-create-hold-concurrent.md` — the concurrency proof
4. `adr/0005-concurrency-hold-then-confirm.md` — the *why*
5. `trade-offs.md` — what was left out, and why

If you have **30 minutes**, also read:

6. `schema.md` and `schema.sql` — the load-bearing partial unique index
7. `diagrams/06-webhook-confirm.md` — webhook security and idempotency
8. `adr/0004-auth-hand-rolled-sessions.md` — the security choices
9. `testing.md` — what the integration tests prove
10. `operations.md` — day-one operational concerns

If you have **an hour**, read the remaining ADRs and diagrams in order.

## A note on the writing style

The docs are deliberately direct and short. The repo isn't large; the goal of the writing is to make the reasoning visible, not to fill pages.
