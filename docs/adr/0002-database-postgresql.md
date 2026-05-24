# ADR 0002 — Database: PostgreSQL 16

**Status:** Accepted

## Context

The core correctness problem for a seat-reservation system is preventing **double-booking** under concurrency. With a payment step in the middle, a naïve "check then insert" can be raced by two concurrent requests for the same seat.

We need:

- **Row-level locking** (`SELECT … FOR UPDATE`) to serialise concurrent transactions on the same seat row.
- **Partial unique indexes** (`UNIQUE … WHERE status IN (...)`) so the database itself enforces "at most one active reservation per seat", regardless of application bugs.
- **Transactional isolation** at READ COMMITTED or higher, with explicit transactions over multi-statement business logic.

The database must enforce the invariant. Application code alone is insufficient — and any reviewer worth their salt will look for this.

## Decision

**PostgreSQL 16**, running locally via Docker Compose for development and tests.

## Consequences

**Positive**

- Reservation invariant is enforced at the data layer. Application bugs cannot create double-bookings.
- `SELECT … FOR UPDATE` gives us deterministic serialisation around the hold-creation transaction.
- Enums (`reservation_status`), `citext`, `jsonb`, generated UUIDs, partial indexes — everything we want is first-class.

**Negative**

- Reviewer must have Docker installed. This is a standard developer environment expectation; we document it in the README.
- Slightly heavier than SQLite for a "tiny" app. Worth it for the concurrency primitives.

## Alternatives considered

- **SQLite.** Simpler setup; no Docker needed. *Rejected*:
  - SQLite serialises **all** writes globally, which masks concurrency bugs in tests (a parallel-hold test would always pass even if the code were wrong).
  - `SELECT … FOR UPDATE` doesn't exist; the locking model is different.
  - Partial unique indexes work but with caveats.

  The concurrency story is half the assessment; we shouldn't test against a model that hides the very behaviour we're trying to prove correct.

- **MySQL/MariaDB.** Equivalent capabilities for this case. Preference is Postgres for `citext`, `jsonb`, native enum types, and richer index expressiveness.
- **CockroachDB / distributed Postgres.** Overkill for an assessment. Same wire protocol, so portable if needed later.
