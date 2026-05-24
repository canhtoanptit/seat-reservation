# ADR 0008 — Deployment: Docker Compose for local; cloud path documented

**Status:** Accepted (revised: app is also in Compose for the one-command demo)

## Context

The submission spec is explicit: **runs locally**. There is no requirement (or evaluation) for a public deployment.

We still want the reviewer to see that we've thought about the production path, and that the local setup is faithful to it (same database engine, same migrations, no SQLite-vs-Postgres surprise in CI). A reviewer should also be able to demo the app with a single command — no toolchain other than Docker.

## Decision

Two complementary paths, both first-class.

**Path A — One-command demo (`make demo` or `docker compose up -d --build`).**

Compose brings up **both** services:

- `postgres` (port 5432)
- `app` (port 3000), built from the multi-stage `Dockerfile`. The container's `docker/entrypoint.sh` applies migrations and seeds the seat pool on start, then `exec`s `next start`.

The image runs as a non-root user, has a `HEALTHCHECK` against `/api/health`, and the compose service `depends_on: postgres { condition: service_healthy }` so order is correct.

The compose `app` service deliberately sets `NODE_ENV=development` so the in-repo mock payment provider mounts (see ADR 0006). In a real production deploy this would be `NODE_ENV=production` with `STRIPE_*` env vars replacing `MOCK_PAYMENT_*`.

**Path B — Local dev with hot reload.**

`make db-up` (or `docker compose up -d postgres`) starts only Postgres; the app runs on the host via `pnpm dev`. This is the iteration loop while making changes.

**Cloud (documented, not built).**

The README describes a Vercel + Neon (or Railway/Fly) deployment as the production path:

- Where the `MOCK_PAYMENT_*` env vars would be replaced by `STRIPE_*`.
- Where the public webhook URL would come from.
- How migrations would run (a release-phase command rather than the container entrypoint, since clustered deploys want a single migrate step).

## Consequences

**Positive**

- The reviewer can demo with a single command and no language toolchain beyond Docker.
- The image is a portable artefact that mirrors what a real deploy would build.
- The hot-reload iteration path is preserved when the reviewer wants to read or change code.
- Migrations run automatically on container start; idempotent on re-runs.

**Negative**

- Docker image build takes a couple of minutes the first time. Acceptable for a one-time demo cost.
- Running migrate-on-start is fine for single-replica demos but **wrong** for clustered production — multiple replicas would all race to migrate. Documented in `operations.md` as a known caveat with the production recommendation (release-phase migrate job).
- The compose `app` service runs with `NODE_ENV=development` to enable the mock provider. Explicit and documented; would not match a real production setup.

## Alternatives considered

- **Compose with Postgres only; app always on the host.** What we had originally. *Revised* because reviewers benefit from the one-command path more than they lose from not having hot reload by default.
- **All-in-Docker with mounted source for hot reload.** Possible (bind mount + `next dev` inside the container) but adds platform-specific filesystem-notification quirks. Path B already gives the reviewer hot reload by stepping outside Docker for the app.
- **Bring-your-own Postgres (Homebrew / Postgres.app).** Most flexible but harder to reproduce. Each reviewer would have a different version, configuration, locale. *Rejected* for lack of determinism.
- **Vercel + Neon for the actual submission.** Would require a stable public URL (so the mock webhook can call back), maintaining secrets in two places, and inviting flaky network failures in the reviewer's evaluation. *Rejected* for the take-home; documented as the production path.
- **Next.js `output: 'standalone'`.** Would yield a smaller runtime image. *Rejected* for this scope because the migrate/seed scripts need `pg` and `drizzle-orm` at runtime, which complicates standalone dependency tracing. The slightly-larger image is an acceptable trade-off.
