# Architecture

## System shape

Dixora starts as a modular monolith. Deployment units are intentionally few,
while source modules are separated by business capability.

```text
Browser / PWA
    |
    v
Next.js web application
    |
    v
FastAPI /api/v1 modular monolith ---- WebSocket clients
    |          |          |
    v          v          v
PostgreSQL   Redis      S3 / MinIO
    |
    v
Persisted print jobs <----> Local Print Bridge ----> printer adapter
```

PostgreSQL is authoritative for operational and financial state. Redis is for
ephemeral coordination such as rate limits, short-lived caches, and background
job queues; losing Redis must not erase accepted orders, payments, inventory
movements, or audit records. MinIO provides the local S3-compatible object
storage boundary for images and tenant logos.

## Repository boundaries

```text
apps/
  web/            Next.js App Router user interfaces
  api/            FastAPI modular monolith
  print-bridge/   Local printing protocol and mock transport
packages/
  config/         Shared TypeScript compiler and environment helpers
  shared-types/   Browser/bridge wire contracts without business logic
  ui/             Small reusable, accessible presentation primitives
infrastructure/
  docker/         Local container build and initialization assets
docs/             Decisions, domain rules, and operational guidance
```

The Python API owns domain rules. Shared TypeScript types improve client
integration but are not an alternate source of domain truth. OpenAPI generation
and a future code-generation check should prevent drift.

## Backend module boundaries

The API is organized by domain:

- `auth`
- `tenants`
- `branches`
- `users`
- `roles`
- `catalog`
- `inventory`
- `tables`
- `orders`
- `kitchen`
- `qr_menu`
- `payments`
- `reporting`
- `printing`
- `subscriptions`
- `audit`
- `realtime`

Routes validate transport concerns and call application services. Services
enforce authorization and transaction boundaries. Repositories or focused query
objects encapsulate tenant-scoped persistence where they improve clarity.
Domain code must not depend on FastAPI request objects.

Cross-module writes happen through explicit application services, not direct
mutation of another module's tables from route handlers. A service may share the
same SQLAlchemy session so a vertical operation remains one database
transaction.

## Request and trust flow

1. The edge assigns or propagates a request ID.
2. Authentication validates the session, tenant state, user state, and branch
   grant.
3. An immutable request context carries actor, tenant, branch, permissions, and
   session identifiers.
4. Authorization checks an operation-specific permission.
5. The service loads resources with tenant-aware filters and validates related
   branch scope.
6. The transaction writes domain state, audit data, and persisted events.
7. After commit, background dispatch publishes real-time updates or performs
   external side effects.

Identifiers submitted by a client locate resources but never establish the
tenant. Public QR and Print Bridge credentials use separate restricted
principals.

## Data and consistency

- UUID primary keys
- UTC timestamps in storage
- `NUMERIC`/`Decimal` for money and quantities
- Foreign keys, checks, tenant-aware uniqueness, and indexes
- Optimistic version columns on concurrently edited operational aggregates
- Idempotency records for order submission, payments, QR requests, and printing
- Soft deletion or explicit lifecycle states for historical entities
- Append-only stock movements and audit logs from normal application flows

Orders, payments, inventory movements, print acknowledgements, and audit entries
must use documented transaction boundaries. External actions are never performed
inside an uncommitted database transaction.

## Real-time behavior

WebSockets provide low-latency notifications for tables, orders, kitchen,
approvals, bill requests, and printer status. They are not the source of truth.
Events carry an ID, scope, type, occurrence time, version, and small payload.

Clients reconnect with backoff, then refetch authoritative HTTP resources. A
persisted outbox is the intended mechanism for reliable post-commit dispatch.
The initial API may use a simpler in-process publisher, but it must be labeled as
a development limitation until the outbox and worker are active.

## Background work

Background jobs are appropriate for media processing, report exports, expired
session cleanup, outbox dispatch, retryable integrations, and notifications.
They are not a substitute for transactional order changes. The initial worker
technology is deliberately undecided until a concrete job is implemented;
Redis-backed workers can be added without splitting the API into microservices.

## Storage

Product images and business logos are addressed through an S3-compatible
service. The database stores object keys and metadata, not arbitrary external
URLs as authority. Uploads require:

- Tenant-derived prefixes
- Content-type and decoded-file validation
- Size and dimension limits
- Random object keys
- Private-by-default access
- Signed URLs or a controlled public media path
- Asynchronous thumbnail generation when needed

The checked-in logos are references, not optimized production assets. A clean
vector master and reviewed light/dark derivatives remain brand preparation work.

## Deployment model

Docker Compose is local development orchestration, not the production topology.
Production will independently deploy web, API, workers, and bridge artifacts
against managed stateful services. Container images must be immutable,
non-root, scanned, and configured only through environment or secret stores.

## Scaling triggers

Do not split a module because its directory is large. Consider an independent
service only when ownership, availability, data lifecycle, or measured scaling
requirements cannot be met safely in the monolith. Likely future boundaries are
media processing, long-running report exports, and third-party delivery
connectors—not the core order transaction.
