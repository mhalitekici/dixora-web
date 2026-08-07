# Printing and Print Bridge protocol

Printing is a persisted job workflow. Browser print dialogs are useful for
manual documents but are not the unattended kitchen/bar transport.

## Components

- API printing module creates and owns jobs.
- PostgreSQL stores job state and attempts.
- A branch-scoped local Print Bridge claims jobs.
- A printer adapter translates normalized documents to a local transport.
- The current adapter is mock-only.

## Job states

| State       | Meaning                                            |
| ----------- | -------------------------------------------------- |
| `PENDING`   | Eligible to be claimed                             |
| `CLAIMED`   | Leased to one bridge/attempt                       |
| `SENT`      | Accepted by the local adapter/spool boundary       |
| `PRINTED`   | Adapter confirmed the configured success condition |
| `FAILED`    | Attempt failed with a sanitized error              |
| `CANCELLED` | Job is no longer eligible                          |

The API owns valid transitions. A stale claim lease may be retried according to
policy. `PRINTED` is terminal except for a new explicitly marked reprint job.

## Job record

Required persisted fields include:

- `id`, `tenant_id`, `branch_id`
- `preparation_station_id`, `printer_device_id`
- `order_id`, `kitchen_ticket_id`
- Normalized versioned payload
- `status`, `attempt_count`, `last_error`
- `created_at`, `claimed_at`, `sent_at`, `printed_at`
- Idempotency key, job kind, lease owner, and lease expiry

Original, copy, and reprint semantics are explicit. A reprint is a new job
linked to the original, displays `COPY` or `REPRINT`, records actor/reason, and
creates an audit entry.

## Enrollment and authorization

A bridge credential is issued for one tenant, branch, bridge ID, and allowed
printer set. The API derives this scope from the credential; request fields
cannot broaden it. Credentials are stored outside source control, rotated, and
never logged.

Production enrollment, mutual TLS, device attestation, and remote key rotation
are not implemented by the mock.

## Current bridge protocol

The FastAPI module exposes:

```text
POST  /api/v1/printing/bridge/claim
PATCH /api/v1/printing/bridge/jobs/{jobId}
```

It authenticates `X-Print-Bridge-Token`. Tokens are stored only as hashes and
resolve to one persisted tenant/branch bridge record; submitted query fields
cannot broaden that scope. Claiming uses row locks and `skip_locked`, records
the claiming bridge, and updates only accept jobs claimed by that same bridge.
The TypeScript bridge consumes this protocol. A one-time raw token is returned
when a manager enrolls a bridge.

Every claim includes a required comma-separated `printer_codes` query value.
The API normalizes the codes, joins the job to an active `PrinterDevice` in the
credential's tenant and branch, and returns that persisted `printer_code` to
the adapter. A bridge therefore cannot claim a job routed to a printer it did
not declare, even when multiple bridges serve the same branch.

For the checked-in development seed only, `X-Print-Bridge-Key` plus a branch ID
remains as an explicit compatibility path. Production settings reject seed mode,
so this fallback cannot become production authority accidentally.

The current claim has no lease expiry, so a bridge crash after `CLAIMED` can
leave a job stuck until an operator intervenes. This is another release blocker,
not an acceptable retry policy.

Before physical printing or any untrusted network deployment, add lease expiry,
attempt-bound acknowledgement idempotency, credential rotation, and the
cross-tenant/replay tests described below.

## Future hardened batch-claim target

```http
POST /api/v1/printing/jobs/claim
Authorization: Bearer <bridge-key>
X-Dixora-Bridge-Id: local-mock-bridge
Content-Type: application/json
```

```json
{
  "bridge_id": "local-mock-bridge",
  "branch_id": "00000000-0000-0000-0000-000000000001",
  "printer_ids": ["MOCK-KITCHEN", "MOCK-BAR"],
  "max_jobs": 5
}
```

The API ignores `branch_id` as authority and verifies every requested printer
against the credential. Claiming is atomic, for example with row locking and
skip-locked semantics. The response is an array or `{ "items": [...] }`.

Normalized job example:

```json
{
  "id": "f8a5e6c8-576a-46d2-a651-eec8f23795f1",
  "tenant_id": "77825697-a74c-4b4b-8ac1-6b4acb33c5a2",
  "branch_id": "00000000-0000-0000-0000-000000000001",
  "printer_device_id": "b5a16064-dfbb-4b9c-94f8-4c17acb48ee7",
  "printer_code": "MOCK-KITCHEN",
  "preparation_station_id": null,
  "order_id": "50328733-2df3-48a1-a879-5d1b203f5cfa",
  "kitchen_ticket_id": null,
  "attempt_count": 1,
  "claimed_at": "2026-07-30T20:00:00Z",
  "kind": "ORIGINAL",
  "payload": {
    "content_type": "application/vnd.dixora.receipt+json",
    "copies": 1,
    "is_reprint": false,
    "document": {
      "title": "KITCHEN",
      "branch_name": "Dixora Lab Main Branch",
      "station_name": "Kitchen",
      "order_number": "A-100",
      "table_name": "R4",
      "waiter_name": "Servis Personeli",
      "submitted_at": "2026-07-30T20:00:00Z",
      "lines": [
        {
          "name": "Classic Burger",
          "quantity": "1",
          "modifiers": ["Extra cheese"],
          "note": "No onion"
        }
      ]
    }
  }
}
```

The bridge validates version/content type, copy limits, required identifiers,
and document structure before printing.

## Hardened acknowledgements

```text
POST /api/v1/printing/jobs/{jobId}/sent
POST /api/v1/printing/jobs/{jobId}/printed
POST /api/v1/printing/jobs/{jobId}/failed
```

Each transition includes `bridge_id`, `attempt_count`, and a stable
`Idempotency-Key`. Printed payload:

```json
{
  "bridge_id": "local-mock-bridge",
  "attempt_count": 1,
  "result": {
    "external_reference": "local-mock-bridge:MOCK-KITCHEN:job-id:1",
    "printed_at": "2026-07-30T20:00:02Z",
    "transport": "mock"
  }
}
```

The API verifies current lease owner and attempt. Repeated acknowledgements with
the same key return the original outcome.

## Delivery safety

Physical printing creates an unavoidable ambiguity: the printer can succeed
while the network acknowledgement fails. Production safety requires a durable
local journal recording job, document hash, send result, and acknowledgement
state. On restart, the bridge retries acknowledgements before deciding to print
again.

The current mock bridge only keeps this cache in memory. Therefore it proves the
protocol shape and ordinary idempotency, not crash-safe exactly-once physical
printing.

## Health and observability

- `/healthz`: process liveness
- `/readyz`: successful API polling readiness
- Structured events for claims, sends, prints, failures, and acknowledgements
- Metrics for queue age, attempts, failures, offline duration, and printer state
- Receipt contents, credentials, and sensitive customer notes excluded from
  ordinary logs

## Adapter roadmap

An adapter interface must define device discovery, capabilities, encoding,
paper width, cut/kick commands, status feedback, timeout, and success semantics.
Candidate implementations require hardware-specific acceptance tests. No
ESC/POS, Windows spooler, USB, or network printer support is claimed today.

## Required tests

- Two bridges cannot claim the same attempt
- Credential cannot claim another branch/printer
- Transition idempotency and stale-attempt rejection
- Lease expiry and retry
- Reprint marking and audit
- Unsupported/malformed payload rejection
- Crash between local success and remote acknowledgement
- API/TypeScript contract compatibility
