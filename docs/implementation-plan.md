# Dixora implementation plan

This plan turns the product brief into independently verifiable vertical
slices. A milestone is complete only when its user flow, authorization,
database behavior, tests, documentation, and operational checks pass together.

## Delivery rules

- Keep one deployable FastAPI modular monolith and one Next.js application
  until measured constraints justify another boundary.
- Every tenant-owned write derives `tenant_id` from authenticated context.
- Every branch-scoped write derives or validates `branch_id` against the
  authenticated user's branch grants.
- Store money and stock quantities as decimal values; never introduce floating
  point arithmetic in a financial or inventory path.
- Persist important events before broadcasting them over WebSockets.
- Add idempotency and transaction boundaries before exposing payment, order
  submission, stock deduction, or print acknowledgement endpoints.
- A page is not complete while its primary controls are placeholders.
- Record deferred behavior in the relevant document and test the boundary that
  remains.

## Current baseline

As of the initial repository foundation:

- The npm workspace, Docker Compose topology, PostgreSQL, Redis, MinIO, web, API,
  and mock Print Bridge service contracts exist.
- Shared TypeScript config, API wire types, and a small framework-neutral UI
  package exist.
- The mock Print Bridge validates jobs, reports transitions, exposes health
  endpoints, and has unit tests.
- The FastAPI and Next.js applications are under active Milestone 1
  implementation.

The foundation is not a production release. In particular, a physical printer
transport, production secrets, durable background jobs, PostgreSQL RLS
activation, online payments, fiscal devices, and production infrastructure are
not implemented.

## Milestone 1 — foundation

Scope:

- Monorepo and reproducible local environment
- FastAPI application, OpenAPI, structured errors, logging, and health endpoint
- SQLAlchemy models and Alembic migration baseline
- Tenant, branch, user, role, permission, session, and audit foundations
- Password login, refresh rotation, logout, and authenticated identity
- Separate Super Admin, business, and waiter route groups and layouts
- Realistic Dixora Lab development seed
- Tenant-isolation tests for read, write, update, delete, and foreign reference
  attempts

Exit gate:

```bash
docker compose config --quiet
docker compose up --build --detach
docker compose run --rm api alembic upgrade head
docker compose run --rm api pytest
npm run check
```

The seed command and development credentials must match the root README before this
gate is signed off.

## Milestone 2 — catalog and tables

Scope:

- Categories, products, modifiers, branch availability, and preparation station
  routing
- S3-backed product image upload with file type, size, and authorization checks
- Areas and tables with secure public QR tokens
- Admin CRUD screens with validation and optimistic concurrency
- Live table-state read model and reconnect refetch behavior

Required tests:

- Cross-tenant category/product/table references fail
- Decimal prices round and serialize consistently
- Modifier minimum/maximum constraints hold
- A compromised table token can be rotated without changing the internal table
  UUID

## Milestone 3 — operational ordering

Scope:

- Table sessions and the unified order engine
- Waiter and cashier operational flows
- Item snapshots, modifiers, notes, partial submission, approvals, transfers,
  merges, splits, discounts, payments, and audit entries
- Kitchen tickets and real-time station routing
- Transactional outbox or equivalent persisted event dispatch

Required tests:

- Duplicate order and payment submissions are idempotent
- Tenant and branch boundaries hold on every command
- Concurrent table updates detect stale versions
- Newly submitted items do not resend earlier kitchen items
- Restricted actions require an approval and produce audit records

## Milestone 4 — QR menu and ordering

Scope:

- Public branch and table menu routes using the same catalog
- QR appearance settings, general and table-specific code downloads
- Signed, expiring table sessions and abuse controls
- Customer cart and order request
- Default waiter approval, rejection, and conversion into the unified order
  engine

Required tests:

- Public tokens do not reveal internal UUIDs
- Replayed submissions return the original result
- Disabled, expired, out-of-hours, or rate-limited sessions cannot order
- Approval is atomic and cannot create duplicate orders

## Milestone 5 — inventory and reporting

Scope:

- Inventory ledger, stock balances, recipes, counts, adjustments, transfers, and
  waste
- Accepted-order deduction and cancellation/refund reversal
- Low-stock notifications
- Indexed operational reports with tenant, branch, permission, and date filters

Required tests:

- Recipe calculations remain decimal-safe
- Concurrent deductions cannot silently lose stock
- Negative stock policy and authorized override are audited
- Reversals point to the original movement
- Reports cannot aggregate another tenant's rows

## Milestone 6 — printing foundation

Scope:

- Print job creation, atomic claim, preparation-station routing, retries, and
  reprint marking
- Bridge enrollment and scoped credentials
- Durable local acknowledgement journal
- Mock adapter retained for CI and development
- Protocol compatibility tests between API and bridge

Physical printer support remains a separately accepted adapter milestone. It
must not be inferred from the existence of the mock bridge.

## Quality gates for every milestone

- Formatting, linting, type checking, migrations, and tests pass
- OpenAPI and shared contracts agree
- Keyboard, touch target, responsive, loading, error, and empty states are
  reviewed
- Tenant/branch authorization tests cover new resources and references
- Sensitive actions create append-only audit records
- Index and query plans are reviewed for new high-volume access paths
- Documentation describes the actual behavior and known limitations
- No secrets, generated credentials, build output, or customer data enter source
  control

## Release preparation still required

- Pin immutable container image versions and produce an SBOM
- Add CI, dependency scanning, secret scanning, and signed artifacts
- Select hosted PostgreSQL, Redis, and S3 providers with backup/restore tests
- Define observability, alerting, retention, and incident response
- Complete threat modeling and penetration testing
- Establish data processing, privacy, tax, fiscal, and regional compliance
  requirements
- Load test busiest table, kitchen, QR, and reporting scenarios
