# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the Next.js seat-reservation app.
#
#   deps     install dependencies (including dev for build) + native modules
#   builder  produce the Next.js production build
#   runner   minimal runtime image (no pnpm/corepack — uses node_modules/.bin)
#
# The runtime entrypoint applies pending migrations and seeds the 3 seats
# (idempotently) before starting `next start`.

ARG NODE_VERSION=24-bookworm-slim

# ── deps ──────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Build tools for argon2's optional native fallback. (Prebuilt binaries are
# used when available; build-essential ensures we can compile if not.)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Build-time placeholders. `next build` evaluates server modules to collect
# route configuration; those modules import `src/lib/env.ts`, which validates
# process.env on import. The build container has no real env, so we provide
# safe placeholders here. Runtime values come from docker-compose and
# replace these — these strings never reach a request.
ENV DATABASE_URL=postgres://build:build@build:5432/build
ENV MOCK_PAYMENT_WEBHOOK_SECRET=build-time-placeholder-not-used-at-runtime
ENV MOCK_PAYMENT_BASE_URL=http://localhost:3000

RUN pnpm build

# ── runner ────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV PATH=/app/node_modules/.bin:$PATH

# Non-root user. --create-home gives them a writable $HOME (some Node tooling
# expects one to exist even if we don't write to it).
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs --create-home --home-dir /home/nextjs --shell /bin/sh nextjs

# Ship the built app plus everything the migrate/seed scripts need. We do NOT
# install pnpm/corepack here — runtime uses node + node_modules/.bin directly,
# which avoids the corepack cache permission issue and is one less moving
# part to worry about.
COPY --from=builder --chown=nextjs:nodejs /app/.next               ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public              ./public
COPY --from=builder --chown=nextjs:nodejs /app/node_modules        ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json        ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts      ./next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json       ./tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts   ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts             ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db          ./src/lib/db
COPY --from=builder --chown=nextjs:nodejs /app/docker              ./docker

RUN chmod +x /app/docker/entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["next", "start"]
