# Measured results

Numbers here come from actual runs. Do not quote a capacity figure that is not
backed by a row in this file.

## 2026-08-09 — read-only, ~25 branches

**Setup:** single Docker Compose host (Windows/WSL2, 7.6 GiB available to
Docker), `API_WORKERS=4`, `DIXORA_DB_POOL_SIZE=10`, `DIXORA_DB_MAX_OVERFLOW=20`,
Redis realtime enabled. PostgreSQL, API and web all co-located.

```
locust -f apps/api/loadtest/dixora_load.py --host http://127.0.0.1:8000 \
    --headless -u 100 -r 4 -t 3m --exclude-tags write
```

100 simulated terminals ≈ 25 branches × 4 terminals.

| Endpoint | p50 | p95 | p99 |
| --- | --- | --- | --- |
| `orders: list` | 39 ms | 86 ms | 110 ms |
| `tables: list` | 30 ms | 69 ms | 82 ms |
| `kitchen: tickets` | 48 ms | 92 ms | 170 ms |
| `inventory: items` | 30 ms | 68 ms | 79 ms |
| `qr: public menu` | 27 ms | 65 ms | 88 ms |
| `auth: login` | 210 ms | 330 ms | 350 ms |
| **Aggregate** | **38 ms** | **180 ms** | **290 ms** |

- Throughput: ~8.9 req/s (realistic 3–10 s terminal polling, not a stress ceiling)
- Errors: 0.13 % (2 × `RemoteDisconnected`, keep-alive races; no API-side errors logged)
- Resources after the run: API 1.5 % CPU / 484 MiB, PostgreSQL 0.1 % CPU / 219 MiB

**Reading:** read paths are nowhere near saturation at this scale. Extrapolating
the same polling behaviour, 100 branches ≈ 35 req/s of reads, which this
hardware would very likely absorb — but see the caveats before quoting that.

## 2026-08-09 — read + write, ~25 branches

Same host and settings, but against a **throwaway database** (`dixora_loadtest`,
seeded from scratch) so the write path could run for real. 100 users for 2 min,
including 5 `ContentionTerminal` users all ordering the same product on the same
table.

| Endpoint | p50 | p95 | p99 |
| --- | --- | --- | --- |
| `orders: create` (realistic) | 100 ms | 480 ms | 680 ms |
| `orders: create (same stock)` | 610 ms | 1300 ms | 2200 ms |
| `auth: login` | 270 ms | 620 ms | 760 ms |
| **Aggregate** | **88 ms** | **770 ms** | **1300 ms** |

- Throughput 18.4 req/s, errors 0.14 % (3 × keep-alive `RemoteDisconnected`)
- API 23 % CPU / 628 MiB, PostgreSQL 0.3 % CPU / 765 MiB
- **Inventory correctness held: 0 negative stock balances.**

### Same-row contention is a real serialisation point

An earlier run with the contention class at full weight (≈50 of 100 users all
hitting one table/product) produced `orders: create (same stock)` p50 **5.7 s**,
p95 **11 s** — with **still zero negative balances and zero errors**. Row locks
are doing exactly their job: correctness is preserved, throughput on a single
hot row is not. This is a pathological shape (real branches spread across
tables), but it means one very hot product or table serialises orders. Do not
"fix" this by dropping the `SELECT ... FOR UPDATE`.

## 2026-08-09 — read + write, ~100 branches (400 users) — **DOES NOT PASS**

Same throwaway database, 4 workers, 400 users for 3 min. Two attempts:

**Attempt 1** (`pool_size=10`, `max_overflow=20`, PostgreSQL `max_connections=100`):
8 × HTTP 500 with `asyncpg.TooManyConnectionsError: sorry, too many clients
already`. The deployment asked for up to 4 × 30 = 120 connections against a
limit of 100 — the defaults shipped were themselves unsafe once `API_WORKERS>1`.

**Fixes applied:** pool defaults lowered to 5 + 10 per worker, and
`POSTGRES_MAX_CONNECTIONS` raised to 200 in compose with the formula documented:

    (DIXORA_DB_POOL_SIZE + DIXORA_DB_MAX_OVERFLOW) x API_WORKERS < max_connections

**Attempt 2** (after the fixes): no more 500s, but latency is unacceptable.

| Endpoint | p50 | p95 |
| --- | --- | --- |
| `auth: login` | 3.6 s | 13 s |
| `orders: create` | 9.4 s | 19 s |
| **Aggregate** | **2.8 s** | **8.8 s** |

Plus 92 × `RemoteDisconnected` (server dropping connections under load).

**Conclusion: 100 branches is NOT supported on this configuration.** Removing
the hard failure only converted it into queuing — 400 concurrent terminals
against 4 × 15 = 60 pooled connections queue by definition.

**Important caveat on this measurement:** it was taken on a single 7.6 GiB
developer machine that was simultaneously running PostgreSQL, Redis, MinIO, the
web app, a *second* API stack, and Locust itself. It is evidence that this
*setup* fails at 400 users; it is **not** evidence that a properly provisioned
server would. A real verdict needs a dedicated environment, and likely PgBouncer
plus more than one API host.

## Caveats — what these runs do NOT prove

1. **50 branches was never measured** — only 25 (passes) and 100 (fails).
2. **Login is expensive under a thundering herd.** An earlier run ramping all
   100 users at once (`-r 20`) produced login p50 **3.9 s**, max **6.8 s**.
   Argon2 is deliberately costly (64 MiB, parallelism 4); 100 simultaneous
   hashes saturate CPU and memory bandwidth. Shift change at a large chain is
   exactly this pattern. Mitigations to consider: stagger logins, lengthen
   sessions so re-login is rare, or move hashing off the request workers. Do not
   "fix" this by weakening Argon2 parameters.
3. **Single co-located host**, no reverse proxy, single PostgreSQL with no
   replica. A node failure is still total downtime.
4. **50/100-branch profiles have not been run.**

## Still to measure

- 50 branches, to find where the ceiling actually sits between 25 and 100
- A rerun of 100 branches on dedicated hardware, with PgBouncer
- Sustained soak (hours, not minutes) to surface connection-pool leaks
