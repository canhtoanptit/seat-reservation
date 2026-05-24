# ADR 0006 — Payment provider: in-repo mock with Stripe-shaped contract

**Status:** Accepted

## Context

The spec permits a mock payment provider. The interesting engineering signal in payment integration is not "can we call a function"; it's:

- **Webhooks** — async confirmation from the provider; you must verify a signature, handle out-of-order delivery, and be idempotent.
- **Intents and redirects** — the user is bounced to an external page; you must track state across that hop.
- **Idempotency keys** — retrying "create intent" must not create duplicate intents.
- **Failure modes** — payment fails, user abandons, provider goes silent.

We want a mock that exercises *all* of these. A function call doesn't.

## Decision

Build a mock provider as a **route group inside the same Next.js app**, behaving exactly like Stripe:

- `POST /api/mock-pay/intents` — create intent. Body: `{ amount_cents, currency, idempotency_key, return_url }`. Response: `{ id, client_url }`. Persists nothing on the provider side beyond an in-memory map (or, for honesty, a small `intents` table local to the mock).
- `GET /mock-pay/[intentId]` — checkout UI. Shows the amount and three buttons: **Succeed**, **Fail**, **Cancel**.
- On click, the page POSTs a signed event to `/api/webhooks/payment`:
  - `X-Signature: sha256=<hex>` where `hex = hmac_sha256(MOCK_PAYMENT_WEBHOOK_SECRET, body)`.
  - Body: `{ id, type: 'payment.succeeded' | 'payment.failed' | 'payment.cancelled', intent_id, created_at }`.
  - Then redirects the user back to `return_url`.

The app talks to a **`PaymentProvider`** TypeScript interface; the mock is one implementation, Stripe would be another. Swapping in real Stripe is a single adapter change.

## Consequences

**Positive**

- Zero external dependencies. Tests run offline.
- Webhook idempotency, HMAC signing, and signature verification are **exercised for real** in tests.
- The integration code reads as Stripe-shaped; reviewer can mentally substitute Stripe and have it make sense.
- Swap path is documented: change the `PaymentProvider` implementation, set `STRIPE_*` env vars, done.

**Negative**

- The mock skips some realities of real Stripe (3DS challenges, async checkout sessions, multi-event sequences like `payment_intent.requires_action`). Acceptable for this scope.
- Mixing the mock provider into the same Next.js process is a code smell at production scale (anyone could call the mock endpoints if deployed). Mitigation: the mock is gated by `MOCK_PAYMENT_ENABLED` (a boolean env var, defaults to `true` in development and is explicitly set in `docker-compose.yml`). When false, the mock's intent endpoint, checkout page, and webhook-emitter action all return 404 / no-op. Set `MOCK_PAYMENT_ENABLED=false` in any real deploy.

## Alternatives considered

- **Real Stripe in test mode.** More realistic; needs an account, public webhook URL (ngrok), and online dev environment. *Rejected* for portability and offline reproducibility.
- **In-process function call ("payment.confirm()")**. Easier but skips the webhook / idempotency / signing learning, which is half the point of integrating a payment provider.
- **Separate mock service in a sibling Docker container.** Cleaner separation but extra moving parts for marginal benefit on a take-home.
