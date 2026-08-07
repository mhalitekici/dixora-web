# Order lifecycle

All order sources use the same aggregate and command services. A source changes
intake and approval policy; it does not create a second order model.

## Aggregate responsibilities

An order owns:

- Source, branch, currency, table session, and optional customer label
- Immutable-at-sale product, price, tax, discount, and modifier snapshots
- Item-level preparation state
- Totals and version
- Payments, discounts, cancellations, approvals, and lifecycle events

Submitted or paid history is preserved. Catalog edits do not alter snapshots.

## Order states

| State               | Meaning                                   | Typical next states                          |
| ------------------- | ----------------------------------------- | -------------------------------------------- |
| `DRAFT`             | Staff is editing unsent items             | `SUBMITTED`, `CANCELLED`                     |
| `SUBMITTED`         | A submission batch is persisted           | `AWAITING_APPROVAL`, `ACCEPTED`, `CANCELLED` |
| `AWAITING_APPROVAL` | QR or restricted action awaits staff      | `ACCEPTED`, `CANCELLED`                      |
| `ACCEPTED`          | Operational responsibility begins         | `PREPARING`, `CANCELLED`                     |
| `PREPARING`         | At least one station is working           | `PARTIALLY_READY`, `READY`                   |
| `PARTIALLY_READY`   | Some, but not all, active items are ready | `READY`, `SERVED`                            |
| `READY`             | All active preparation items are ready    | `SERVED`                                     |
| `SERVED`            | Items were delivered                      | `BILL_REQUESTED`, `PAYMENT_PENDING`          |
| `BILL_REQUESTED`    | Customer requested settlement             | `PAYMENT_PENDING`, `SERVED`                  |
| `PAYMENT_PENDING`   | Settlement is in progress or partial      | `PAID`                                       |
| `PAID`              | Required total is settled                 | terminal under normal flow                   |
| `CANCELLED`         | Order was cancelled before settlement     | terminal                                     |
| `VOIDED`            | Authorized exceptional invalidation       | terminal and audited                         |

Transitions are commands with explicit preconditions, not arbitrary status
patches. Item states may cause aggregate states, but one slow station must not
erase already-ready items.

## Submission batches

Waiters often add products after earlier items are already in preparation.
Each submit command creates a batch or records a submitted-at boundary. Kitchen
tickets reference only newly submitted items. Previously routed items are never
silently reprinted.

The client supplies an idempotency key and expected order version. The server:

1. Loads the order in tenant/branch scope.
2. Verifies table session, permission, version, and product availability.
3. Recalculates prices and modifiers from authoritative catalog data.
4. Creates snapshots and the submission boundary.
5. Applies the acceptance policy.
6. Creates kitchen tickets, stock effects, audit records, and outbox events in
   one transaction where applicable.
7. Returns the original response for a matching retry.

A reused idempotency key with a different request fingerprint is rejected.

## Acceptance and inventory

The default inventory deduction point is acceptance/send-to-preparation, not
cart editing. This matches operational consumption while allowing QR requests
to wait without reserving stock.

Acceptance:

- Locks or version-checks the order
- Creates one deduction movement per recipe input
- Links movements to order items and the acceptance event
- Applies the branch negative-stock policy
- Allows a permissioned override only with a reason and audit record

Cancellation after deduction creates reversal movements. It never deletes the
original ledger entries.

## Kitchen routing

Products resolve to a preparation station at submission time. A ticket contains
snapshot names, modifiers, notes, table, waiter, source, and submission time.
Station reassignment later does not move historical tickets.

Kitchen commands operate at item/ticket scope and are idempotent. Real-time
messages follow commit; reconnecting displays the database state.

## Discounts, cancellations, and approvals

Permissions and business thresholds decide whether an action applies directly
or creates an approval request. Approval records capture requester, resolver,
reason, payload, timestamps, and result.

The resolver cannot approve a stale request whose order version or target item
no longer matches. Self-approval policy is configurable and defaults to
disallowed for sensitive operations.

Partial cancellation:

- Targets explicit item quantities
- Preserves the original line
- Creates cancellation and reversal records
- Updates totals
- Notifies affected station
- Marks reprints clearly

## Tables, moves, merges, and splits

Table operations lock source and destination sessions in deterministic ID order
to reduce deadlocks. They validate branch, current state, active payments, and
permissions. A transfer changes service context but not historical tenant or
branch ownership.

Splits create explicit allocation records or new checks while preserving the
origin of every item and payment. Amount-based splits define rounding ownership
so the sum always equals the order total.

## Payments

Each payment command is idempotent and uses decimal values. The server validates
remaining balance, method, permissions, and order version in a transaction.
External payment providers are out of initial scope; recording a card payment
does not imply card processing.

Removing a payment means a permissioned reversal, not deletion. An order becomes
`PAID` only when settlement rules are satisfied. Reopen behavior requires an
explicit policy, reason, approval, and audit trail.

## Required invariants

- Totals equal the sum of current snapshots, discounts, tax, and reversals
- Paid amount cannot silently exceed policy
- A cancelled item cannot enter preparation again without a new line
- One submission batch routes each item once
- One idempotency key executes one semantic command
- State and item transitions are monotonic except explicit audited recovery
- Tenant and branch never change through client-submitted IDs
- Every sensitive transition has actor, reason where required, and audit entry
