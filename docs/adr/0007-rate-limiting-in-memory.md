# ADR 0007 — Rate limiting: in-memory token bucket

**Status:** Accepted (with explicit migration path to Redis)

## Context

Login is the obvious abuse surface for this app:

- Credential stuffing across many emails from one IP.
- Targeted password guessing against a single email from many IPs.

We need rate limiting on `/login`. We do **not** need a distributed rate-limiter ceremony for a single-node assessment.

## Decision

In-process **token bucket** rate limiter:

- Keyed by **IP** and **email** separately (both must be under-quota for the attempt to proceed).
- Limits:
  - **Per (IP, email)**: 5 failed attempts per 15 minutes.
  - **Per IP**: 30 attempts per 15 minutes (defends shared-NAT scenarios from full lockout).
- A **successful** login resets that key's counter.
- Implementation: in-memory `Map<string, { count, resetAt }>` with lazy eviction on access.

A complementary mitigation: when the email doesn't exist, the login server action still runs `argon2.verify` against a fixed dummy hash, so failure timing doesn't leak account existence.

## Consequences

**Positive**

- Cheap. No external dependency. Right-sized for single-node operation.
- Reduces the credential-stuffing and password-guessing surface significantly.

**Negative — explicit and documented**

- **Lost on process restart.** An attacker willing to restart the process (or wait for a deploy) can churn it. Acceptable here.
- **Single-node only.** If we horizontally scale, an attacker can round-robin across instances and effectively multiply the limit by node count. The README and `operations.md` both call this out and point at Redis as the next step.
- Memory grows with distinct keys until eviction. Bounded by the 15-minute window plus a hard cap (defensive).

## Alternatives considered

- **Redis (Upstash / self-hosted) backed limiter.** The right answer at scale. *Out of scope* for this submission; would introduce a second stateful component for negligible benefit at a single replica.
- **No rate limiting at all.** Negligent. Rejected.
- **`express-rate-limit` or similar middleware.** Functionally equivalent; we'd still write the (IP, email) composition ourselves, so we built it directly to keep the logic visible.
- **CAPTCHA after N failures.** Adds a third-party dependency and UX friction. Worth doing at scale; out of scope here.
