# Load testing

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
| --- | --- |
| 10 | 40 |
| 25 | 100 |
| 50 | 200 |
| 100 | 400 |

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
