# ADR 0003 — ORM and migrations: Drizzle + drizzle-kit

**Status:** Accepted

## Context

We want:

- Strong TypeScript types for queries.
- **Explicit, programmatic transactions** (the hold flow needs `BEGIN`, `SELECT FOR UPDATE`, conditional logic, `INSERT`, `COMMIT`).
- The ability to drop to raw SQL for things the ORM doesn't model — partial unique indexes on expressions, `FOR UPDATE`, enum types.
- Plain, **inspectable migrations** that we can read in PRs and run forward in production.

## Decision

**Drizzle ORM** for queries and types, **drizzle-kit** for migration generation.

## Consequences

**Positive**

- Transactions are explicit: `await db.transaction(async (tx) => { … })`.
- Type inference flows from the schema to query results without a runtime codegen step.
- Migrations are real SQL files committed to the repo. The reviewer can read them.
- Native enum support, native `pgcrypto` and `citext` extensions, and raw SQL passthroughs (`sql\`…\``) are first-class.

**Negative**

- Smaller ecosystem than Prisma. Some patterns (deeply nested relations) are friction. *Acceptable* — we don't need them here.
- The migration files are generated; they need to be reviewed before commit. Standard discipline.

## Alternatives considered

- **Prisma.** Larger ecosystem, slightly nicer ergonomics for simple cases. *Rejected*:
  - Less direct control over transactions and FOR UPDATE (interactive transactions feel grafted on).
  - The shadow-DB-driven migration model is opaque; we prefer plain SQL migrations.
  - Relation queries pull more than we need by default; here we want to be exact.

- **Kysely.** Excellent query builder, similar philosophy. Comparable choice; Drizzle has slightly better schema-as-source-of-truth ergonomics and a migration tool that fits.

- **Raw `pg` + small query helpers.** Honest and lean. *Rejected* for time and ergonomics — we'd be hand-typing query results, which is busywork.
