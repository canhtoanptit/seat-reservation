# ADR 0001 — Framework: Next.js 15 (App Router)

**Status:** Accepted

## Context

We need a TypeScript web app with:

- Email/password authentication and session cookies
- A small UI (3 seats + a checkout page + auth pages)
- Server-side mutations under database transactions (hold creation, payment kickoff, webhook handling)
- An inbound webhook endpoint

The assessment is a single submission that one reviewer reads end-to-end. **Cohesion** (one codebase, one mental model) outweighs strict frontend/backend separation here.

## Decision

**Next.js 15 with the App Router.**

- Server Components for data reads (e.g. listing seats, showing a reservation).
- Server Actions for mutations (`signup`, `login`, `logout`, `createHold`, `cancelHold`, `beginPayment`).
- A standard `route.ts` for the webhook endpoint and the mock provider's API routes.
- `src/` directory layout, strict TypeScript.

## Consequences

**Positive**

- Single codebase, single deploy unit. Fewer moving parts to explain to the reviewer.
- Server Actions get **CSRF protection from Next's Origin/Host enforcement** automatically — no custom token machinery needed for the form-driven flows.
- Co-locating the mock provider in the same app keeps the demo runnable with a single `pnpm dev`.

**Negative**

- Coupling the UI and the API together gives weaker contract testing than a split repo would. We accept this for the scope.
- Lock-in to React Server Components patterns. Acceptable; not a portability blocker.

## Alternatives considered

- **Fastify or Hono backend + Vite React frontend.** More honest separation, better contract testing, easier to swap clients later. *Rejected*: the extra surface area (CORS, fetch wrappers, two dev servers, two build outputs) costs more than it teaches for a take-home of this scope.
- **Remix.** Equivalent capability; Next has more mindshare and the App Router model expresses transactional flows just as cleanly.
- **Express + EJS / plain HTML.** Simplest possible, but the reviewer would (rightly) wonder why we chose a 2010 stack.
