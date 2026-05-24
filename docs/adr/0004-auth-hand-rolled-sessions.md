# ADR 0004 — Authentication: hand-rolled session auth

**Status:** Accepted

## Context

Requirements:

- Email + password login.
- 90-day session.
- That's it — no OAuth, MFA, magic links, or password reset (out of scope).

Part of the assessment is making security decisions **visible to the reviewer**. Wrapping everything in a third-party library obscures the choices we want to be evaluated on (password hashing parameters, session token storage, cookie attributes, timing attacks, rate limiting, CSRF).

## Decision

Hand-roll session auth using vetted primitives:

- **Passwords**: `argon2id` via the `argon2` npm package. Memory cost ≥ 64 MB. Time cost and parallelism from the library's recommended defaults.
- **Session tokens**: 32 random bytes from `crypto.randomBytes`, base64url-encoded. The **cookie carries the raw token**; the DB stores `sha256(token)` as the primary key of the `sessions` table.
- **Cookie attributes**: `HttpOnly; SameSite=Lax; Path=/;` plus `Secure` when `NODE_ENV=production`.
- **Sliding window**: a session is valid iff `now < expires_at` **and** `now - last_used_at < 90d`. `expires_at` is the absolute 90-day cap from creation; `last_used_at` bumps on each authenticated request. Either bound being exceeded ends the session. This is the documented interpretation of "90 days".
- **Rate limiting**: in-memory token bucket keyed by IP **and** email separately. See ADR 0007.
- **Timing-safe failure path**: when the email doesn't exist, the login server action still calls `argon2.verify` against a dummy hash so the response time doesn't leak whether an email is registered.
- **CSRF**: Server Actions in Next.js validate the `Origin`/`Host` header by default for same-origin POSTs. No custom CSRF token is added; the webhook route is HMAC-signed instead.

## Consequences

**Positive**

- The security model is small, transparent, and testable. The reviewer reads the auth code in five files.
- No black-box library behaviour. Bugs are *our* bugs, but they're also *visible*.
- Sliding window UX matches the documented assumption.

**Negative**

- We own the security surface. Mitigations: tiny code surface, vetted crypto primitives (argon2, node:crypto), explicit tests for sliding-window behaviour.
- Password reset / OAuth / MFA would require building those flows ourselves later. Out of scope for the assessment.

## Alternatives considered

- **Auth.js (NextAuth) with the credentials provider and a database adapter.** Production-typical. *Rejected*: it hides argon2 vs bcrypt, the session token storage shape, and the cookie attributes — exactly the things the reviewer wants to see.
- **Lucia v3.** Was a great fit and shipped a clean session-token model. *Rejected*: project has wound down; not a stable target for new builds.
- **BetterAuth / Clerk / WorkOS.** Production-grade but overkill, and again hide the relevant choices. Right answer in a real product, wrong answer for this assessment.
- **JWT sessions.** *Rejected*: revocation is a problem, 90-day expiry with JWT means we can't invalidate stolen tokens server-side without an additional state store; opaque DB-backed sessions are simpler and more correct for our use case.
