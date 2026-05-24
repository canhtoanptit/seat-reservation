# Seat Reservation

A small public seat-reservation platform: three seats, authenticated users, hold-then-pay flow with a Stripe-shaped mock payment provider, and a database-enforced no-double-booking invariant.

> **For the reviewer:** the interesting work is the concurrency model. Start with [`docs/plan.md`](./docs/plan.md), then [`docs/diagrams/04-create-hold-concurrent.md`](./docs/diagrams/04-create-hold-concurrent.md), then [`docs/adr/0005-concurrency-hold-then-confirm.md`](./docs/adr/0005-concurrency-hold-then-confirm.md). [`docs/README.md`](./docs/README.md) has a reading order.

## Quickstart — one command

Prerequisites: **Docker** (with the Compose plugin) and **GNU make**.

```bash
make demo
```

That command builds the app image, brings up Postgres + the app under Docker Compose, applies migrations, seeds the 3 seats, and prints the URL. Then open <http://localhost:3000>.

What you get:

- `postgres` — PostgreSQL 16 on `localhost:5432`
- `app` — the Next.js app on <http://localhost:3000>, with the in-repo mock payment provider mounted

Sign up, reserve a seat, pay (Succeed / Fail / Cancel on the mock checkout), see confirmation. `make logs` tails the app, `make down` stops the stack.

## Quickstart — local dev with hot reload

If you want to iterate on the code, run Postgres in Compose and the app on your host:

Prerequisites: **Node 20+**, **pnpm**, **Docker**.

```bash
pnpm install
cp .env.example .env
make db-up                       # docker compose up -d postgres
pnpm db:migrate && pnpm db:seed
pnpm dev                         # or: make dev (which does the two lines above)
```

## Demo: the concurrency property

1. Open two **private** browser windows on <http://localhost:3000>.
2. Sign up two different users.
3. Both click **Reserve** on the same seat at the same time.
4. **One** wins and lands on the payment page. The **other** sees `Seat unavailable`.
5. The winner pays. The losing user refreshes `/seats` and sees the seat as taken.

The same property is asserted automatically by `tests/integration/concurrent-hold.test.ts`.

## What's where

```
Dockerfile                  multi-stage build for the app image
docker-compose.yml          postgres + app
docker/entrypoint.sh        runs migrate + seed before `next start`
Makefile                    common commands (`make help`)

src/
  app/                      pages, server actions, API routes
  lib/
    env.ts                  Zod-validated env, fail-fast on boot
    logger.ts               pino
    db/                     Drizzle schema, client, migrations
    auth/                   password, session, rate-limit
    reservation/            FSM + service + errors
    payment/                provider interface + mock + webhook logic
scripts/                    migrate, seed, sweep-expired, reconcile, reset
tests/
  unit/                     pure logic
  integration/              real Postgres
  e2e/                      one Playwright happy-path
docs/                       design docs (read this!)
```

## Environment variables

For **`pnpm dev` on the host**: copy `.env.example` to `.env` and the defaults work against the Compose-launched Postgres on `localhost`.

For **Docker Compose**: the `app` service in `docker-compose.yml` sets the same vars but with `DATABASE_URL=postgres://app:app@postgres:5432/...` (service-to-service inside the compose network). You should not need to edit it for the demo.

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection | host: `localhost:5432`; compose: `postgres:5432` |
| `SESSION_COOKIE_NAME` | Session cookie name | `seat_session` |
| `SESSION_TTL_DAYS` | Absolute + sliding cap | `90` |
| `HOLD_TTL_MINUTES` | Hold lifetime before TTL expiry | `10` |
| `PAYING_TIMEOUT_MINUTES` | Stuck-paying threshold | `30` |
| `MOCK_PAYMENT_WEBHOOK_SECRET` | HMAC secret for webhooks | dev-only value |
| `MOCK_PAYMENT_BASE_URL` | Mock provider URL | `http://localhost:3000` |
| `LOG_LEVEL` | pino level | `info` |
| `NODE_ENV` | runtime env | host: `development`; compose: `development` (so the mock provider mounts — see ADR 0006) |

All values are validated at boot via `src/lib/env.ts`; missing or malformed vars crash the process immediately rather than serve broken state.

## Useful commands

`make help` lists everything. The most useful:

```bash
# Docker compose
make demo        # build + start postgres + app, then print the URL
make up          # same as demo without the URL banner
make down        # stop the stack
make clean       # stop + wipe DB volume
make rebuild     # docker compose build --no-cache app
make logs        # follow app logs
make psql        # open psql inside the postgres container
make shell       # shell inside the app container

# Local dev (postgres in compose, app on host)
make db-up       # start only the postgres service
make dev         # postgres up + pnpm dev
make migrate     # apply migrations
make seed        # insert the 3 seats
make reset       # drop + recreate + migrate + seed
make sweep       # expire stale holds + flag stuck-paying

# Tests + quality
make test            # unit + integration (vitest)
make test-marquee    # just the concurrent-hold test
make test-e2e        # Playwright happy-path
make typecheck       # tsc --noEmit
make lint            # eslint
make check           # typecheck + lint + test
```

Direct pnpm scripts work too (e.g. `pnpm test`, `pnpm db:migrate`, `pnpm sweep`, `pnpm reconcile <id> --outcome=succeeded`).

## Production path (documented, not built)

This submission runs locally. For production:

- **Hosting**: Vercel (Next.js) + Neon or Railway (Postgres). Alternatively, build the same image with `docker build` and deploy to Fly, ECS, or Cloud Run.
- **Payment**: swap the `PaymentProvider` adapter to Stripe (the webhook handler already expects an HMAC signature header) and set `STRIPE_*` env vars instead of `MOCK_PAYMENT_*`. The mock routes only mount when `NODE_ENV !== 'production'`.
- **Migrations**: run `pnpm db:migrate` (or `pnpm exec tsx scripts/migrate.ts` if `pnpm` isn't installed in the image) as a release-phase command before swapping traffic. The container's entrypoint already does this on start; in clustered deploys you usually want a single, dedicated migrate step instead.
- **Rate limiting**: replace the in-memory token bucket with a Redis-backed one. See `docs/adr/0007-rate-limiting-in-memory.md`.
- **Observability**: add OpenTelemetry around the hold-and-pay transaction; ship pino logs to a log aggregator.

See [`docs/trade-offs.md`](./docs/trade-offs.md) for the full list of trade-offs and what we'd do differently with more time.

## Tests

```bash
make test                                                # unit + integration
make test-marquee                                        # just the marquee
make test-e2e                                            # Playwright happy-path
```

The marquee test (`concurrent-hold.test.ts`) spawns 10 parallel `createHold` calls for the same seat and asserts that exactly one wins. See `docs/testing.md`.

> **Note:** the integration tests run against the same Postgres as `pnpm dev` and `TRUNCATE` all app tables between tests. After running the suite, run `make reset` (or `make seed`) before demoing manually. At scale this would be a separate `seat_reservation_test` database; documented as a trade-off in `docs/trade-offs.md`.

## License

See `LICENSE`.
