# Measured Performance Results

Generated: 2026-08-30T02:13:30.656Z

The benchmark was run against the local Docker/PostgreSQL stack using:

```bash
API_URL=http://localhost:8181 \
WRITE_RESULTS=1 \
TASKS=10000 \
CONCURRENCY=25 \
node scripts/load.mjs
```

## Results

| Metric | Measured result |
|---|---:|
| Requested tasks | 10,000 |
| Successful writes | 10,000 |
| Failed writes | 0 |
| Write duration | 3.20 s |
| Write throughput | 3,126.3 tasks/s |
| Tasks read | 10,000 |
| Cursor pages | 100 |
| Page p50 | 1.0 ms |
| Page p95 | 5.5 ms |
| Page p99 | 10.4 ms |
| Page max | 10.4 ms |

These numbers are a reproducible local benchmark, not a claim about production Vercel/Neon throughput. The production deployment was verified separately with the smoke suite; the 10,000-write benchmark is intentionally not run against the free/shared production database.
