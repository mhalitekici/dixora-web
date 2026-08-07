# Multi-tenancy

Dixora uses a shared database and schema. Tenant isolation is therefore a
cross-cutting security invariant, not a convention left to individual pages.

## Scope hierarchy

```text
Dixora platform
└── Tenant / business
    ├── Branch
    │   ├── areas and tables
    │   ├── inventory and stations
    │   └── orders, payments, tickets, and print jobs
    └── users, roles, catalog defaults, and business settings
```

A platform principal has no implicit tenant scope. A tenant principal has one
tenant and a set of branch grants. Public QR sessions and Print Bridge devices
are restricted service principals with smaller capabilities.

## Context derivation

1. Validate the credential or public token.
2. Load active server-side session/grant state.
3. Build an immutable context containing actor, tenant, branch, permissions, and
   request ID.
4. Pass context into application services and repository/query methods.

`tenant_id` in request bodies, query strings, or headers never establishes
scope. Super Admin routes that target a tenant use an audited platform operation
and explicit target ID; they do not reuse a business user's implicit context.

## Persistence rules

- All tenant-owned tables include non-null `tenant_id`.
- Branch-owned operational tables include non-null `branch_id`.
- Create commands assign tenant from context.
- Reads, updates, and deletes filter by tenant before returning or mutating.
- Related IDs are loaded inside the same tenant and, where required, branch.
- Unique constraints include tenant scope.
- Critical foreign keys include tenant/branch components or have equivalent
  enforced checks.
- Bulk operations, reports, exports, WebSocket subscriptions, and background
  jobs use the same scoped services.

Returning `404` for an out-of-scope resource usually avoids existence
disclosure. Permission-denied responses are used when the resource is known to
be in scope but the actor lacks an action.

## Public QR isolation

Business and branch slugs select a public configuration, while a random table
token locates the table. The API verifies all three resolve to the same tenant
and branch. A signed, expiring session binds subsequent requests to that table;
an internal UUID from the browser is never accepted as authority.

## Print Bridge isolation

A bridge credential is enrolled for one tenant/branch and an allowed printer
set. Claim requests may describe the local bridge, but the API derives allowed
scope from the credential. Atomic claims filter by that scope. A bridge cannot
acknowledge an unclaimed job or a job belonging to another branch.

## WebSocket isolation

Socket authentication creates the same context as HTTP. Subscriptions are
server-defined channels, not arbitrary tenant IDs sent by the client. Every
outbound event includes scope and is filtered before delivery. Reconnection
refetches authorized HTTP resources.

## RLS defense in depth

PostgreSQL RLS is planned after transaction-local tenant context is verified
with pooled connections. Policies fail closed on missing context. Migration,
platform support, public QR, and worker roles require explicit designs; no
database superuser is used by the normal application.

Until RLS is enabled and tested, documentation must not claim database-enforced
isolation. Application filters and constraints are required regardless.

## Mandatory isolation test matrix

For representative resources in every domain, a Tenant A actor attempts to:

- List and read Tenant B rows
- Update and delete Tenant B rows
- Reference a Tenant B parent while creating a Tenant A row
- Trigger a command using a Tenant B table, product, printer, or order ID
- Subscribe to Tenant B real-time events
- Export or aggregate Tenant B report data
- Claim or acknowledge Tenant B print jobs

Repeat branch-specific cases across two branches in the same tenant. Tests use
unguessable UUIDs but still assume identifiers can leak; security must not
depend on secrecy of IDs.

## Review checklist

- Is scope derived from a credential rather than submitted data?
- Does every query—including counts and existence checks—filter scope?
- Can a related resource cross tenant or branch through a foreign key?
- Does caching include tenant/branch in its key?
- Are jobs, events, files, logs, and metrics scoped?
- Does an error reveal another tenant's existence?
- Is the path covered by an automated negative test?
