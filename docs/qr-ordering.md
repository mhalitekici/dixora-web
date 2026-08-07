# QR menu and ordering

The public QR experience uses the same catalog and order engine as staff
interfaces. It adds a restricted public session and an approval-safe intake
workflow.

## Public routes

```text
/m/{businessSlug}
/m/{businessSlug}/{branchSlug}
/m/{businessSlug}/{branchSlug}/table/{tableToken}
```

Slugs are public labels. `tableToken` is random, non-sequential, revocable, and
never an internal table UUID. The server verifies business, branch, and table
belong to the same active scope.

## Modes

- `MENU_ONLY`: browse without submitting
- `WAITER_APPROVAL`: create a request for staff review
- `AUTOMATIC_ACCEPTANCE`: directly run normal acceptance checks
- `DISABLED`: no public menu/order service

The default is `WAITER_APPROVAL`. Automatic acceptance is opt-in per branch and
still validates availability, limits, service hours, and table session.

## Table session

Opening a table route may create a signed, expiring public session bound to:

- Tenant, branch, and table
- QR token version
- Issued and expiry times
- Random session identifier
- Ordering mode and optional staff activation

The signature protects integrity; server-side state supports revocation, rate
limits, replay detection, and optional staff activation. Rotating a compromised
table token invalidates earlier sessions according to policy.

Do not collect customer accounts or unnecessary personal information in the
initial release.

## Menu response

The public menu is a filtered read model from catalog data:

- Active QR-visible categories and products
- Branch/day/time availability
- Current sold-out state
- Variants and modifier constraints
- Decimal price, currency, allergens, and localized content
- Sanitized business contact and appearance settings

Cost price, internal notes, stock counts, employee data, tenant IDs, and
administrative controls never appear.

## Submission flow

1. Customer reviews the final table identity, items, modifiers, quantities,
   notes, and total.
2. Client submits session token and a fresh idempotency key.
3. Server validates signature/state, rate limits, expiry, mode, service hours,
   table status, item limits, catalog availability, and authoritative prices.
4. Server stores an immutable QR request snapshot.
5. In `WAITER_APPROVAL`, staff receives a persisted notification.
6. Staff accepts or rejects with the current request version.
7. Acceptance invokes the unified order command and links the resulting order.
8. Customer polls or receives scoped real-time status updates.

Acceptance and order creation are one transaction or one idempotent state
machine. Two staff members cannot accept the same request twice.

## Abuse prevention

- Per-session, table, branch, and network rate limits
- Maximum line count, quantity, note length, and order value
- Expiring sessions and configurable staff activation
- Request body and decoded image limits
- Idempotency fingerprinting
- Bot protection only when evidence justifies the added friction
- Generic public errors without internal identifiers
- Audit/security events without unnecessary customer tracking

Rate limiting is not a substitute for server-side price and availability checks.

## QR generation

Administrators can generate:

- Branch menu QR
- Table-specific QR
- PNG download for ordinary use
- SVG download for print
- Batch print sheets with visible business, branch, and table labels

Generated QR destinations use the configured public base URL. Tokens are never
embedded in analytics links owned by an unrelated third party. Regeneration is
an audited destructive action with confirmation.

## Caching and SEO

Branch menu pages can use short cache lifetimes and explicit invalidation.
Table-session and cart responses are private and never shared-cacheable.
General public menus may be indexable by configuration; table-token URLs should
be `noindex` to avoid token discovery and search clutter.

## Known initial limitations

- Customer accounts, online payments, loyalty redemption, and delivery
  integrations are out of scope.
- Full multilingual authoring and custom domains are roadmap work.
- Production bot controls, privacy text, and service-hour edge cases require
  product/legal review.
- The initial real-time layer may fall back to polling until persisted event
  dispatch is active.

## Required tests

- Token entropy, expiry, rotation, and scope mismatch
- Menu hides internal and unavailable data
- Price or table manipulation is ignored/rejected
- Duplicate submit and duplicate approval
- Expired, disabled, closed-hours, and rate-limited behavior
- Cross-tenant slug/token combinations
- Rejected request cannot later be accepted
- Accepted request routes exactly once to inventory and kitchen
