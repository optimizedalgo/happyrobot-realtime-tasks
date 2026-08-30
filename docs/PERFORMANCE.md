# Performance & Scale Challenge

Implemented:

- Fixed-height virtualized task rendering: only visible rows + overscan are mounted.
- Cursor pagination on `(created_at, id)`; no deep `OFFSET` scans.
- Trigram-backed task-title search for dependency selection across large projects.
- PostgreSQL indexes for project/task ordering, status filtering, comments, event replay, title search, and dependency lookup.
- `scripts/load.mjs` creates 10,000 tasks by default and measures write throughput and page-read p50/p95/p99.

## Reproduce

```bash
WRITE_RESULTS=1 TASKS=10000 CONCURRENCY=25 node scripts/load.mjs
```

With `WRITE_RESULTS=1`, the script writes the measured results to `docs/PERFORMANCE_RESULTS.md`. The repository includes the measured 10,000-task run used for this submission; rerunning the command overwrites the report with results from the current machine/runtime. Benchmark numbers are not fabricated.

## Why these choices matter

Keyset pagination keeps later pages approximately the same query shape as early pages. Browser virtualization prevents DOM size from growing linearly with loaded tasks. Search avoids requiring 10,000 task objects in browser memory simply to select a dependency.

## Next measurements

- end-to-end collaboration propagation p50/p95/p99 under concurrent writers;
- conflict/lock rate under intentionally contended updates;
- reconnect replay time after long disconnects;
- browser frame time/memory while scrolling large loaded sets;
- database CPU/connections under multiple Vercel API instances.
