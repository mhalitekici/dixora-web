# Inventory

Inventory is an append-only movement ledger with a transactionally maintained
balance. It supports direct-sale products and recipe ingredients per branch.

## Core concepts

- `InventoryItem`: ingredient or tracked sellable item
- `InventoryLocation`: branch stock location
- `StockBalance`: current materialized quantity for one item/location
- `StockMovement`: immutable quantity change and business reason
- `ProductRecipe`: versioned product yield definition
- `ProductRecipeItem`: required item and quantity
- `StockCount`: physical count session
- `StockAdjustment`: permissioned correction with reason
- `Supplier`: integration-ready identity, not a purchasing module yet

## Units and decimals

Supported initial units include piece, gram, kilogram, milliliter, and liter.
Quantities use decimal values with documented scale. Recipes normalize
compatible units through explicit conversion factors:

```text
1 kilogram = 1000 grams
1 liter    = 1000 milliliters
```

Pieces are not convertible to weight or volume without a product-specific rule.
Floating point values are forbidden in API, service, and database calculations.

## Movement types

- `PURCHASE`
- `SALE`
- `WASTE`
- `ADJUSTMENT`
- `TRANSFER_IN`
- `TRANSFER_OUT`
- `RETURN`
- `COUNT_CORRECTION`

Each movement stores tenant, branch, location, item, signed decimal quantity,
unit, source type/ID, actor, reason where required, occurrence time, and
idempotency key. A reversal links to the original movement.

## Deduction lifecycle

Default deduction occurs when an order is accepted/sent to preparation. For each
accepted item:

1. Load the recipe version applicable to the product/branch.
2. Multiply each input by ordered quantity divided by recipe yield.
3. Normalize units.
4. Lock affected balances in deterministic order.
5. Enforce negative-stock policy.
6. Insert movements and update balances in the same transaction.
7. Link movements to order item and acceptance event.

Later recipe edits do not rewrite earlier deductions. Cancellation or refund
creates proportional reversal movements according to the documented operational
policy.

## Negative stock

The tenant policy may:

- Prevent acceptance
- Allow and warn
- Require a permissioned override

An override captures actor and reason and creates audit data. A race between two
orders must not bypass the policy; balance locks or atomic conditional updates
are required.

## Counts and adjustments

A stock count records a snapshot of expected quantity and entered physical
quantity. Posting a count creates `COUNT_CORRECTION` movements; it does not
replace ledger history. Closed counts are immutable.

Manual adjustments and waste require permissions, reasons, and audit entries.
Large adjustments can use configurable approval thresholds.

## Transfers

Transfers are one business operation with linked `TRANSFER_OUT` and
`TRANSFER_IN` movements. Both sides commit atomically when locations share the
database. A future inter-system transfer needs an explicit in-transit state and
reconciliation workflow.

## Availability

Low-stock state is derived from balance and minimum threshold. Product sold-out
behavior is separately configurable:

- Continue sale
- Mark unavailable
- Require override

Automatic availability updates publish after commit and must not overwrite a
manual temporary sold-out flag without a clear precedence rule.

## Reporting and reconciliation

The ledger supports movement history, theoretical consumption, count variance,
waste, low stock, and recipe cost. Reports filter tenant, branch, location,
item, movement type, and time, with indexes and pagination.

Periodic reconciliation proves:

```text
opening balance + sum(movements) = current balance
```

Any repair creates a correction movement and incident record.

## Known initial limitations

- Purchasing, supplier invoices, batch/lot expiry, and costing methods are not
  implemented in the foundation.
- Recipe versioning and unit conversion require complete API/UI flows before
  being considered production-ready.
- Offline multi-device stock conflict resolution is not defined.
- Report accuracy requires all cancellation/refund paths to emit reversals.

## Required tests

- Decimal precision and conversion
- Recipe yield and multi-quantity deduction
- Concurrent deduction and negative-stock policy
- Idempotent acceptance and reversal
- Cross-tenant/branch item references
- Count posting and immutable history
- Transfer balancing
- Low-stock and sold-out precedence
