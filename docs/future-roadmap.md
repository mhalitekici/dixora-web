# Future roadmap

The roadmap preserves likely extension points without treating speculative
modules as implemented.

## Near term: complete the operational core

- Finish Milestones 1–6 and their isolation/idempotency gates
- Persisted outbox and background worker
- Durable Print Bridge journal and first reviewed hardware adapter
- Production-ready object upload and media processing
- Operational dashboards based on indexed queries
- Accessibility, offline-state communication, and device testing
- CI, dependency/security scanning, backups, restore drills, and observability

## Customer and revenue features

- Reservation and waitlist management
- Customer loyalty and consent-aware profiles
- Gift cards and stored-value rules
- Online payments through an isolated provider adapter
- Delivery marketplace and first-party delivery integrations
- Promotions and centrally evaluated feature entitlements
- Custom domains and richer multilingual QR menus

Payment work requires provider selection, webhook signature verification,
idempotent reconciliation, refunds, dispute handling, and applicable compliance.
It is not represented by merely adding a payment-method label.

## Hospitality expansion

- Hotel room lookup and room-charge authorization
- Folio posting and reversal
- Property/room service workflows
- PMS integrations
- Multiple property and cross-branch reporting

Room charges must be an integration-backed payment flow with guest/room
verification and reconciliation, not a free-form payment method.

## Finance and compliance

- Accounting exports and provider adapters
- Invoice/e-receipt readiness
- Fiscal cash register integrations by jurisdiction
- Tax profiles, service charges, and currency rules
- Data retention, tenant export, deletion, and legal hold workflows

Requirements vary by country. Product and legal discovery precede
implementation; no current foundation should be described as fiscally
compliant.

## Platform maturity

- Subscription billing and invoices
- Feature plan enforcement and tenant overrides
- Support-mode approvals and session recording
- Tenant self-service export and lifecycle automation
- SSO, WebAuthn, and stronger device management
- Integration API, scoped service accounts, webhooks, and developer portal
- Warehouse/replica analytics if operational PostgreSQL load justifies it

## Architecture evolution triggers

Remain a modular monolith unless evidence supports a split. A service boundary
requires:

- Independent availability or scaling need
- Clear data ownership and consistency model
- Stable versioned contract
- Operational ownership, observability, deployment, and incident plan
- Evidence that the new network boundary improves the system

Potential future standalone workloads are media processing, report exports,
notification delivery, and third-party connector execution. The transactional
order core should remain together until a proven constraint says otherwise.

## Explicit non-goals for the initial release

- Kafka, Kubernetes, Elasticsearch, or a service mesh
- A general event-sourcing rewrite
- AI-driven operational decisions without reliable underlying workflows
- Offline-first conflict resolution for full cashier operations
- Unverified physical printer, fiscal, payment, or hotel integrations
- Decorative analytics that cannot be reconciled to source transactions

## Product discovery backlog

- Country, tax, privacy, receipt, and retention requirements
- Supported currencies and rounding rules
- Target printer models, OS platforms, and network conditions
- Restaurant workflows for courses, voids, shifts, tips, and cash drawers
- Hotel/PMS providers and room-charge liability
- Delivery providers and menu synchronization ownership
- Subscription plans, metering, trials, and grace periods
- Accessibility languages, localization, and right-to-left requirements
