# Operations

A short, practical doc covering the things you'd actually need on day one of running this.

## Daily-driver commands

There are two workflows. Most operational tasks use the host commands; the Docker path is for the one-command demo.

### Docker (one-command demo)

```bash
make demo                        # build + start postgres + app; print URL
make up                          # same as demo
make down                        # stop the stack (data persists)
make clean                       # stop + wipe DB volume
make rebuild                     # docker compose build --no-cache app
make logs                        # tail app logs
make psql                        # psql inside the postgres container
make shell                       # shell inside the app container
```

The compose `app` service's entrypoint runs `pnpm db:migrate` and `pnpm db:seed` (idempotent) before `next start`. On a single-replica demo this is fine; in clustered production you want a single dedicated migrate step instead — set `RUN_MIGRATIONS=0` on the app containers and run the migrate script as a release-phase job.

### Local dev (host runs the app)

```bash
# Install
pnpm install

# Bring up Postgres only
docker compose up -d postgres    # or: make db-up
docker compose down              # stop
docker compose down -v           # stop + wipe data

# Schema
pnpm db:migrate                  # apply pending migrations forward
pnpm db:seed                     # insert the 3 seats (idempotent)
pnpm db:reset                    # drop + recreate + migrate + seed (dev only)

# Run
pnpm dev                         # Next.js dev server (hot reload)
pnpm build && pnpm start         # production-mode local

# Tests
pnpm test                        # unit + integration (vitest)
pnpm test:e2e                    # playwright happy-path

# Operational scripts
pnpm sweep                       # expire stale holds + flag stuck-paying
pnpm reconcile <reservation_id>  # operator-driven reconciliation
```

## Sweeper (`scripts/sweep-expired.ts`)

What it does, in order:

1. `UPDATE reservations SET status='expired', updated_at=now() WHERE status='held' AND hold_expires_at < now();` — releases abandoned holds. (The lazy expiry on read paths already covers most cases; this is a backstop for seats no-one is currently looking at.)
2. `SELECT id FROM reservations WHERE status='paying' AND hold_expires_at < now() - interval '30 minutes';` — finds stuck-paying rows.
3. For each stuck-paying row, `INSERT INTO audit_log (action='stuck_paying_detected', target_id=..., detail=...)`. **No automatic state change.**

Production: run from cron every minute. Dev: run manually.

```cron
# crontab in prod
* * * * * cd /app && pnpm sweep >> /var/log/seat-sweep.log 2>&1
```

## Stuck `paying` recovery

If the sweeper logs a `stuck_paying_detected` for reservation R, the operator workflow is:

1. Look up the `payments.provider_intent_id` for R.
2. Check the provider dashboard for that intent's true state.
3. Run `pnpm reconcile R`:
   - If the provider says **succeeded**: applies `payment.succeeded` to the FSM (`paying → confirmed`), inserts an `audit_log` `manual_reconciliation_succeeded`.
   - If the provider says **failed**: applies `payment.failed` (`paying → failed`), inserts `manual_reconciliation_failed`.
   - If the provider says **abandoned/expired**: applies `expired` (`paying → expired`).

`reconcile` is intentionally a separate script, not the webhook handler, because the operator is asserting "I have looked at this; apply the truth." It logs to `audit_log` with the operator identity (taken from an env var or CLI arg) so the audit trail is real.

## Webhook replay

The provider may re-deliver a webhook (network blip, our 5xx). The handler's behaviour:

- Re-delivery of an already-processed `event_id` → 200 OK, no state change. (Detected via `webhook_events (provider, event_id)` UNIQUE.)
- Re-delivery while the original is still being processed → the second one waits on the row lock, sees the work is done, and returns 200.
- Receipt of a never-seen event for an unknown intent → 200 OK with an `audit_log` `webhook_unknown_intent`. (The provider would otherwise retry forever; we accept the event so retries stop, and surface it for review.)
- Bad signature → 401 + `audit_log` `webhook_signature_failure`. We do **not** return 4xx for a missing intent because that would tell an attacker which intent IDs exist.

## Schema migrations

- `pnpm db:migrate` runs `drizzle-kit migrate`. Migrations are SQL files in `src/lib/db/migrations/`.
- **Forward-only.** No `down` migrations. Reverting is a new forward migration.
- Generated with `pnpm db:generate` after editing `src/lib/db/schema.ts`. Review the generated SQL before committing.
- Production: run as a release-phase command before swapping traffic to the new version. Locally: run before `pnpm dev`.

## Health check

`GET /api/health` returns `{ ok: true, db: 'ok' }` with HTTP 200 after a `SELECT 1`. Returns 503 if the `SELECT 1` fails. Used by container orchestrators (and by humans, who curl it to confirm "the app is up and can talk to the DB").

## Secrets and env vars

- All env vars are validated at boot via `src/lib/env.ts` (Zod). **Boot fails loudly** if any are missing or malformed.
- `.env.example` is the source of truth for what must be set. Copying it to `.env` should give a working local environment.
- The required vars:

  | Name | Purpose | Local default |
  |---|---|---|
  | `DATABASE_URL` | Postgres connection string | `postgres://app:app@localhost:5432/seat_reservation` |
  | `SESSION_COOKIE_NAME` | Cookie name for the session token | `seat_session` |
  | `SESSION_TTL_DAYS` | Both `expires_at` and the inactivity window | `90` |
  | `HOLD_TTL_MINUTES` | Hold lifetime before TTL expiry | `10` |
  | `MOCK_PAYMENT_WEBHOOK_SECRET` | HMAC secret for webhook signing | dev secret in `.env.example` |
  | `MOCK_PAYMENT_BASE_URL` | Where the mock provider lives (same app, configurable) | `http://localhost:3000` |
  | `LOG_LEVEL` | pino log level | `info` |
  | `NODE_ENV` | Standard | `development` |

## Mock provider safety

The mock payment provider only mounts when `NODE_ENV !== 'production'`. In production, hitting `/api/mock-pay/*` or `/mock-pay/*` returns 404. This prevents the mock from being a real-money bypass if you ever did deploy the build with `MOCK_PAYMENT_*` set.

## Recovery scenarios

| Situation | What to do |
|---|---|
| Reservation stuck in `paying`, real payment succeeded | `pnpm reconcile <id>` (script checks provider and applies correct state) |
| User charged twice (extremely unlikely given idempotency_key) | Refund manually at provider; `audit_log` will show both events |
| Webhook signature failures spike | Likely a leaked or rotated `MOCK_PAYMENT_WEBHOOK_SECRET`. Rotate; existing in-flight intents will fail webhook delivery and need `reconcile` |
| Postgres down | App returns 503 from `/api/health`; pages 500 with a generic error. No data loss because all writes are transactional |
| Sessions table grows unbounded | A periodic job to `DELETE FROM sessions WHERE expires_at < now() OR last_used_at < now() - interval '90 days';` Trivially added; out of scope here |
| All 3 seats confirmed, app gets traffic | Seats page renders all as taken with no CTA. Working as intended for a single-event app |
