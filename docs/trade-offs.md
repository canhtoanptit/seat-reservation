# Trade-offs

This is the single doc that surfaces every conscious compromise so a reviewer doesn't have to dig.

## What I deliberately did

- **Database-enforced invariants over application-enforced.** The partial unique index plus `FOR UPDATE` makes the seat invariant immune to application bugs. The application *also* checks, but the database is the ground truth. See `adr/0005-concurrency-hold-then-confirm.md`.
- **Hand-rolled session auth** rather than a library — the security choices (argon2id, sha256-hashed session tokens, sliding-window 90-day expiry, IP+email rate limit, dummy-hash timing defence) are visible in the code. See `adr/0004-auth-hand-rolled-sessions.md`.
- **Stripe-shaped mock payment provider** rather than a function-call mock — the webhook signing, idempotency, and intent-creation code is real. Swap to Stripe by replacing one adapter. See `adr/0006-payment-in-repo-mock.md`.
- **Sliding-window session expiry** as the documented interpretation of "90 days". Captures both an absolute cap and an inactivity cap.
- **Lazy expiry on read** + **sweeper as backstop**, rather than a queue. Right-sized for this scale; abandoned holds free up immediately on the next visitor.
- **An `audit_log` table**, even though minimal, to make the operational concern visible.

## What I deliberately did **not** do, and why

| Skipped | Why | What I'd do instead at scale |
|---|---|---|
| Redis (locks, rate-limit, session cache) | Single Postgres handles correctness; Redis would be ceremony, not safety. | Redis-backed rate limiter; possibly a Redis cache for session reads to remove the per-request DB hit. |
| Job queue (BullMQ / SQS / Temporal) | Small inventory; sweeper script + lazy expiry covers it. | Queue with retries for stuck-`paying` reconciliation, webhook reprocessing, dunning. |
| WebSockets / SSE for live availability | Page-load freshness is enough at this scale. | SSE pushing availability changes; aborts a held seat for User B as soon as User A confirms. |
| OAuth / MFA / magic links | Out of spec. | Auth.js or WorkOS once we need them. |
| Real Stripe in test mode | Account + public webhook URL + network dependency in the reviewer's environment. | Swap the `PaymentProvider` adapter; the webhook handler is already shaped to receive Stripe's signature header. |
| Full observability stack (OpenTelemetry, Sentry, Grafana) | `pino` + a `/health` endpoint is enough at this size. | OTel traces around the hold-and-pay transaction; Sentry for unhandled errors; Grafana dashboards on hold-conversion funnel. |
| Email confirmation | Not in spec. | Outbound queue with a provider adapter (Resend / Postmark / SES) + dedupe by reservation_id. |
| Password reset / email verification | Not in spec; would each require an out-of-band side channel and another adapter. | The same outbound-email path, plus a `verifications` table with single-use tokens. |
| Admin UI / multi-event / pricing tiers | Not in spec; invites scope drift. | A separate workspace package later; same DB. |
| Public deployment | Spec says "locally". | Vercel + Neon (or Railway/Fly). The README sketches the differences (`STRIPE_*` instead of `MOCK_*`, public webhook URL, release-phase migrate). |
| CI pipeline | Out of scope. | GitHub Actions: lint + typecheck + Vitest against a Postgres service container; Playwright on PR. |
| Accessibility audit / i18n | Out of scope for this size. | `axe-core` in CI; ICU MessageFormat via FormatJS. |
| `last_used_at` write-behind | Per-request UPDATE is fine at this scale. | Debounced write-behind queue (only persist if changed by > N seconds). |
| Soft-delete on seats | We don't delete seats. | Add `deleted_at`; partial index excludes them from listings. |
| 3DS / SCA flows | The mock doesn't model them. | Real Stripe handles 3DS via `payment_intent.requires_action`; the webhook handler would need to gain a new state in the FSM (`paying → action_required → paying`). |
| Anti-bot CAPTCHA on signup | Not in spec. | hCaptcha or Turnstile on signup and after N login failures. |

## What I'd change with more time, in priority order

1. **Real Stripe Checkout in test mode**, behind the existing `PaymentProvider` interface. The wiring is already there; it's mostly an env-vars and webhook-URL change.
2. **Move the provider call out of the `beginPayment` transaction.** Today the provider call holds a DB row lock for its duration; in production with real Stripe and 3DS, this is too long. The right shape is: create intent (with idempotency key) outside the transaction → short transaction to persist + advance state.
3. **Admin-recovery UI** for stuck-`paying` reservations, replacing the `pnpm reconcile` script with a button. Audit-log-backed.
4. **Synthetic load test** for the hold endpoint. The existing integration test asserts correctness with N=10 in-process promises; a load test (k6 / Artillery) would exercise the same path with real HTTP and many connections.
5. **Move `last_used_at` updates off the request path** (write-behind, debounced).
6. **`/api/health` deep-check variant** (`/api/health?deep=1`) that also pings the payment provider, used by canary deploys.
7. **Persistent rate-limiter** so the limiter survives restarts. Either Postgres-backed (using a small table) or Redis.
8. **Structured request logs** with a request ID surfaced into responses (`X-Request-ID`), so support tickets can be correlated to log lines.

## Known limitations worth being upfront about

- **Single-node only.** In-memory rate limiter, in-process mock provider, no cross-node coordination.
- **No graceful shutdown of in-flight HTTP requests.** Next.js doesn't expose this easily; a `SIGTERM` during deploy could drop a request. At scale you'd put this behind a load balancer that drains.
- **The mock provider can be called by anyone in dev.** Gated by `NODE_ENV !== 'production'` and refuses to mount otherwise; documented in `operations.md`.
- **No password complexity requirements beyond a minimum length.** Argon2id is strong enough that "let users pick what they want" is increasingly accepted, but a real product would enforce policy.
- **`audit_log` is append-only by convention, not by constraint.** A real audit log would be on a separate role/database with no `UPDATE`/`DELETE` granted.
