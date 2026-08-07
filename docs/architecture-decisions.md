# Architecture decisions

This file records decisions that affect multiple modules. Accepted decisions
should be superseded by a new entry rather than silently rewritten.

## ADR-001 — modular monolith first

- **Status:** Accepted
- **Decision:** Use one FastAPI deployable organized by business domain.
- **Why:** Orders, stock, payments, kitchen tickets, and audit records require
  strong local transactions. The team does not yet have independent service
  scaling or ownership needs.
- **Consequence:** Modules require explicit boundaries and tests even though
  they share a process and database.

## ADR-002 — shared PostgreSQL schema with tenant columns

- **Status:** Accepted
- **Decision:** Store tenants in one PostgreSQL database and shared schema.
  Every tenant-owned table has `tenant_id`; branch resources also have
  `branch_id`.
- **Why:** This is operationally simpler for the initial SaaS while supporting
  cross-tenant platform administration.
- **Consequence:** Application scoping, composite constraints, isolation tests,
  and an RLS-ready session context are mandatory.

## ADR-003 — application isolation before RLS enforcement

- **Status:** Accepted with follow-up
- **Decision:** Enforce tenant scope in authentication, services, and queries
  immediately. Design constraints and transactions for PostgreSQL RLS, then
  enable policies after connection-pool context and migration behavior have
  integration tests.
- **Why:** Incorrectly configured RLS can either leak rows or lock out migrations
  and workers.
- **Consequence:** RLS is defense in depth, not an excuse to omit application
  filters. Production readiness requires completing the follow-up.

## ADR-004 — unified order engine

- **Status:** Accepted
- **Decision:** Waiter, cashier, QR, takeaway, delivery, kiosk, and API orders
  use the same order aggregate and command services.
- **Why:** Pricing snapshots, approvals, kitchen routing, stock, and reports
  must behave consistently.
- **Consequence:** Source-specific intake validates and authorizes requests, then
  delegates to shared commands.

## ADR-005 — persisted events plus WebSocket notifications

- **Status:** Accepted
- **Decision:** Commit business state and an outbox/event record together;
  publish WebSocket messages after commit. Clients refetch after reconnect.
- **Why:** Transient socket messages cannot be the only record of an accepted
  operation.
- **Consequence:** An in-process broadcaster is development-only until an outbox
  dispatcher exists.

## ADR-006 — short access tokens and rotated refresh sessions

- **Status:** Accepted
- **Decision:** Use short-lived access tokens and opaque or strongly identified
  refresh sessions with one-time rotation, revocation, and replay detection.
- **Why:** Restaurant terminals need practical sessions without making a stolen
  long-lived token irrevocable.
- **Consequence:** Refresh state is persisted and session management is a
  security-critical domain.

## ADR-007 — S3-compatible object storage

- **Status:** Accepted
- **Decision:** Use an S3 abstraction, with MinIO for local development.
- **Why:** Product images and business logos should not couple the application
  to one cloud vendor or container filesystem.
- **Consequence:** Object keys are tenant-scoped and private by default; MinIO
  parity must be covered by integration tests.

## ADR-008 — local Print Bridge

- **Status:** Accepted
- **Decision:** Persist print jobs in the cloud API and let a branch-scoped local
  bridge claim and acknowledge them.
- **Why:** Browser printing is not reliable enough for unattended preparation
  routing, and cloud servers cannot directly reach local devices.
- **Consequence:** Credentials, atomic claims, idempotent acknowledgements,
  durable local spooling, and explicit reprint marking are required. The current
  transport is mock-only.

## ADR-009 — npm workspaces without an orchestration framework

- **Status:** Accepted
- **Decision:** Use npm workspaces and ordinary scripts initially.
- **Why:** The repository has few JavaScript packages and does not yet need
  distributed build caching or a second task graph.
- **Consequence:** Build order is explicit. Reassess only if CI duration and
  dependency graphs justify another tool.

## ADR-010 — Docker Compose for local development only

- **Status:** Accepted
- **Decision:** Compose defines a complete local topology and health
  dependencies; it is not promoted unchanged to production.
- **Why:** Local onboarding needs one command, while production needs managed
  state, secrets, backups, scaling, and observability.
- **Consequence:** Release infrastructure requires a separate reviewed design.
  Moving image tags used locally must be pinned before shared environments.

## Open decisions

- Background worker implementation and retry semantics
- Production hosting and secret-management providers
- Cookie-based versus bearer-token browser transport after CSRF analysis
- Exact fiscal, tax, retention, and regional compliance rules
- First supported physical printer platform and driver protocol
- Analytics store or replicas if PostgreSQL reporting load becomes material
