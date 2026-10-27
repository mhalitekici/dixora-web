# Load testing

The legacy `dixora_load.py` profile below targets **one tenant**. Increasing
`-u` does not create additional businesses or validate tenant isolation.
Use `pilot_load.py` for the 30-business scenario.

## 30 distinct businesses, 150 staff, 60 simulated printers

Start a separate, disposable stack; its PostgreSQL/MinIO data is held in tmpfs.
The normal development and production projects must not be used. This does not
test physical printers or certify 30-business production capacity.

```bash
docker compose -p dixora-p0-validation -f infrastructure/docker-compose.validation.yml up -d --build --wait api
docker compose -p dixora-p0-validation -f infrastructure/docker-compose.validation.yml exec -T api python -m loadtest.seed_pilot --output /tmp/pilot-manifest.json
docker cp dixora-p0-validation-api-1:/tmp/pilot-manifest.json artifacts/pilot-manifest.json
python apps/api/loadtest/pilot_load.py --manifest artifacts/pilot-manifest.json --seconds 3600 --output artifacts/pilot-result.json
docker cp artifacts/pilot-result.json dixora-p0-validation-api-1:/tmp/pilot-result.json
docker compose -p dixora-p0-validation -f infrastructure/docker-compose.validation.yml exec -T api python -m loadtest.audit_pilot /tmp/pilot-result.json
```

Create `artifacts/` before copying. The manifest contains **test credentials**;
keep it in the ignored artifacts directory and never commit/share it. The seeder
refuses environments other than development and database names other than
`dixora_validation`; it creates fresh slugs and never deletes/reuses tenant data.
Choose a new manifest path for another fixture set. For repeated runs against
the same fixtures, existing test shifts are reused during warmup.

There are five distinct staff logins per tenant: owner, cashier, two waiters and
kitchen. Warmup includes login and shift preparation. During the timed phase,
each staff session reads every five seconds; owners request reports. Thirty
branches each create one order every 120 seconds, staggered four seconds apart:
900/hour in total, 20% through QR. Orders and payments are replayed with the same
key, then reconciled. Two station agents per branch poll every two seconds and
send idempotent SENT/PRINTED acknowledgements; no OS spooler is used.

The post-run audit queries the disposable database, detects unexpected/missing
orders, verifies one payment matching the Decimal total, exactly two correctly
scoped jobs per order, and completed simulated jobs. `capacity_validated` stays
false automatically; an operator must assess the evidence and acceptance goals.

Collect resources in another terminal during warmup **and the entire timed run**:

```bash
python apps/api/loadtest/sample_resources.py --project dixora-p0-validation --seconds 3900 --output artifacts/resources.jsonl
```

The resource stream records Docker CPU/RAM and PostgreSQL total/active connections;
failed samples remain visible. Latency JSON contains endpoint counts and p50/p95/p99,
plus error codes, observed order IDs and simulated dispatch count. Raw response
bodies, passwords and printer tokens are excluded. Local loopback targets only.

For acceptance, use a fresh fixture, a warmup, at least one hour plus a queue drain,
and a longer soak. Proposed gates: zero unaccounted orders/payments/duplicate
dispatches, error rate <0.1%, interactive p95 <500 ms and p99 <1 s, DB connections
below the configured worker/pool budget, stable memory and no growing queue. These
are targets, not measured guarantees. Repeat with realistic data volume and stock
contention (`dixora_load.py`), WebSocket clients, media requests and outage drills.
The synthetic products intentionally do not track inventory. One short local run
cannot validate production hardware, network conditions, fiscal/POS integrations,
offsite recovery, historical report performance or all authorization permutations.

Measures capacity instead of assuming it. **Never run against production** —
the profile creates real orders and payments.

```bash
pip install locust
# interactive
locust -f apps/api/loadtest/dixora_load.py --host http://127.0.0.1:8000
# headless, ~25 branches x 4 terminals for 5 minutes
locust -f apps/api/loadtest/dixora_load.py --host http://127.0.0.1:8000 \
    --headless -u 100 -r 10 -t 5m --csv results/25-branches
```

Users ≈ branches × terminals per branch (cashier, kitchen display, 2 waiter
tablets ≈ 4):

| Branches | `-u` |
| -------- | ---- |
| 10       | 40   |
| 25       | 100  |
| 50       | 200  |
| 100      | 400  |

## What to record

- p50 / p95 / p99 latency and error rate per endpoint (Locust CSV)
- DB pool saturation: `DIXORA_DB_POOL_SIZE + DIXORA_DB_MAX_OVERFLOW` per worker
  vs. PostgreSQL `max_connections`; watch for `QueuePool limit` errors
- `docker stats` for API/Postgres CPU and memory
- `orders: create (same stock)` failures — inventory lock contention

## Before claiming a branch count

Run the matching profile, confirm the error rate stays at zero and p95 stays
acceptable, then record the numbers. No capacity figure should be published
without a run behind it.
