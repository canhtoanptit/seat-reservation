#!/usr/bin/env sh
#
# Container entrypoint.
#
# 1. Apply pending DB migrations (idempotent — drizzle-orm migrator records
#    applied migrations in its own table).
# 2. Seed the 3 seats (idempotent — INSERT ... ON CONFLICT DO NOTHING).
# 3. Exec the CMD (default: `next start`).
#
# Skip the migrate+seed step by setting RUN_MIGRATIONS=0 (useful when running
# the image with a different CMD, e.g. an ad-hoc shell).
#
# This script uses /app/node_modules/.bin directly (it's on PATH via the
# Dockerfile) instead of `pnpm exec`. pnpm/corepack are not in the runner
# image: one less moving part, no $HOME-writable requirements, faster start.

set -e

cd /app

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "[entrypoint] applying migrations…"
  tsx scripts/migrate.ts
  echo "[entrypoint] seeding (idempotent)…"
  tsx scripts/seed.ts
else
  echo "[entrypoint] RUN_MIGRATIONS=0 — skipping migrate/seed"
fi

exec "$@"
