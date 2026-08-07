# Dixora Mock Print Bridge

The Print Bridge is the local-side boundary between Dixora's cloud API and
physical preparation printers. This package implements the protocol and a
development-only mock transport. It does not communicate with ESC/POS, Windows
spoolers, USB devices, or vendor drivers yet.

## What works

- Polls the API for jobs assigned to one branch and a configured printer set.
- Validates claimed payloads before they reach the transport.
- Reports `SENT`, `PRINTED`, and `FAILED` transitions and sends stable
  idempotency keys.
- Simulates print latency and configurable failures.
- Avoids reprinting a completed job while the same process remains alive.
- Exposes liveness at `/healthz` and dependency readiness at `/readyz`.
- Emits structured JSON logs without receipt contents or API credentials.

## Run locally

From the repository root:

```bash
npm install
npm run build --workspace @dixora/config
npm run build --workspace @dixora/shared-types
npm run dev:print-bridge
```

The required variables are documented in the root `.env.example`. For a
standalone mock without an API credential, explicitly set
`PRINT_BRIDGE_ALLOW_INSECURE_MOCK=true`; this option must never be enabled in a
real deployment.

## Protocol summary

1. `POST /api/v1/printing/bridge/claim?printer_codes={configuredCodes}`
2. `PATCH /api/v1/printing/bridge/jobs/{jobId}` with `SENT`
3. Send the normalized document to the configured printer transport.
4. Patch the same job with `PRINTED` or `FAILED`.

The current API authenticates production-style clients with the scoped
`X-Print-Bridge-Token`. Tenant and branch come from that persisted credential.
Every claim must declare its configured printer codes; the API joins them to
active printer devices in the credential's branch before it locks a job. The
legacy `X-Print-Bridge-Key` plus branch query is development-seed-only.

The canonical payload and state transition details live in
[`docs/printing.md`](../../docs/printing.md).

## Known limitations

- The completed-job cache is in memory. A production bridge needs a durable
  local spool and acknowledgement journal before physical printing is enabled.
- The current API does not enforce the idempotency key sent by the bridge.
- The current API claim has no expiring lease, so a process failure after claim
  can require manual recovery.
- Mutual TLS, device enrollment, key rotation, remote configuration, printer
  discovery, and signed updates are future work.
- `SENT` currently means the mock adapter accepted the job; a hardware adapter
  must define this boundary precisely for each transport.
