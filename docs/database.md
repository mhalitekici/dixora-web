# Database design

PostgreSQL is the authoritative store. SQLAlchemy 2 models define application
mapping; Alembic migrations define schema history.

## Conventions

- UUID primary keys, generated server-side or with a cryptographically secure
  application generator
- Lowercase plural table names and explicit constraint names
- `created_at` and `updated_at` stored in UTC
- `tenant_id NOT NULL` on every tenant-owned row
- `branch_id NOT NULL` for branch-specific operational rows
- `NUMERIC(14, 2)` or an explicitly documented precision for money
- Higher-scale `NUMERIC` for stock quantities and recipes
- Integer minor units are acceptable only if one currency precision is
  guaranteed; mixed-currency abstractions must remain decimal-safe
- Native constrained enums or checked strings with migration-safe evolution
- JSON only for genuinely variable snapshots and integration payloads, not as a
  substitute for relational modeling

## Tenant-safe relationships

A simple foreign key to a UUID proves that a row exists, not that it belongs to
the same tenant. Critical relationships should use a tenant-aware pattern:

```sql
UNIQUE (tenant_id, id);
FOREIGN KEY (tenant_id, product_id)
  REFERENCES products (tenant_id, id);
```

For branch-owned relationships, include branch scope where the business rule
requires both records in the same branch. Service checks remain necessary for
nullable and cross-branch concepts.

Tenant-aware uniqueness examples:

- `(tenant_id, slug)` for branch slugs
- `(tenant_id, username_normalized)` for business usernames
- `(tenant_id, branch_id, code)` for printers and stations
- `(tenant_id, sku)` where SKU is tenant-wide
- `(tenant_id, idempotency_key)` for order and print creation

## Financial and historical data

An order item stores product name, unit price, tax, discount, and modifier
snapshots. Later catalog edits do not rewrite historical sales. Payment rows are
append-oriented; corrections use explicit reversal/refund records. Paid orders
are never casually hard-deleted.

Currency is stored with the order and payment context. Rounding rules must be
centralized and tested for line, tax, discount, and total calculations.

## Inventory ledger

`stock_movements` is the immutable business ledger. A stock balance may be
materialized for fast reads, but it must update in the same transaction as its
movement. Reversals reference the original movement instead of mutating it.

Recipe quantities use sufficient precision for conversions such as kilograms to
grams. Units are explicit; implicit conversions are forbidden.

## Concurrency

- Version columns protect tables, orders, QR settings, and mutable
  configurations from lost updates.
- Balance-affecting inventory commands lock the relevant balance rows in a
  deterministic order.
- Atomic `UPDATE ... WHERE version = :expected` is preferred for simple
  aggregates.
- Idempotency records store request scope, fingerprint, status, and result so a
  retry cannot execute the command twice.
- Print claims use row locking with skip-locked behavior or an equivalent atomic
  update.

## Indexing

Every foreign key used for joins or deletion checks needs an index. Common
high-volume patterns include:

- `(tenant_id, branch_id, status, created_at DESC)` for orders and tickets
- `(tenant_id, branch_id, area_id, sort_order)` for tables
- `(tenant_id, branch_id, inventory_item_id, occurred_at DESC)` for movements
- `(tenant_id, action, created_at DESC)` for audit
- `(status, created_at)` for outbox and print workers
- Partial indexes for active/open rows when they materially reduce scans

Indexes are justified by query shape and `EXPLAIN`; avoid indexing every column.

## Row-level security readiness

Intended transaction-scoped settings:

```sql
SET LOCAL app.tenant_id = '<uuid>';
SET LOCAL app.user_id = '<uuid>';
```

Policies can compare `tenant_id` to `current_setting('app.tenant_id', true)`.
Before enabling:

1. Prove connection-pool settings cannot leak between requests.
2. Define behavior for Super Admin support mode, workers, migrations, and public
   QR principals.
3. Add integration tests using the production database role.
4. Ensure missing context fails closed.

RLS is not yet claimed as active until these tests pass.

## Migrations

- One Alembic head on the main branch
- Forward-compatible expand/migrate/contract changes for shared environments
- Data backfills separated from long schema locks
- Downgrades for development where safe; a documented restore plan when data
  loss makes downgrade dishonest
- Application startup may migrate in local Compose, but production migrations
  run as a controlled release job
- PostgreSQL extensions are initialized for new local volumes; migrations must
  still verify required extensions

## Backup and retention work

Production readiness requires encrypted backups, point-in-time recovery,
restore drills, tenant export/deletion rules, audit retention, and tested
disaster objectives. Docker volumes are not backups.
