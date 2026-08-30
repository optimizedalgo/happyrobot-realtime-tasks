# Case-study requirement coverage

This matrix maps the PDF requirements directly to code and demo behavior.

| Case-study requirement | Status | Implementation / evidence |
|---|---:|---|
| Users can create multiple projects | ✅ | Project list/create UI and `POST /api/projects` |
| Add, update, delete tasks within projects | ✅ | REST mutations + optimistic UI + rollback |
| Task dependencies | ✅ | Searchable dependency picker, same-project validation, self-reference rejection, recursive cycle detection |
| Status transitions | ✅ | Explicit server-side transition table; dependency completion guard |
| Comment threads | ✅ | Persisted per-task comments |
| Real-time comments | ✅ | `comment.created` project event |
| Changes visible across clients near real-time | ✅ | Project catalog + task/comment SSE streams; 1.5s durable event-log polling fallback |
| Cross-client consistency | ✅ | Versioned writes, row locks, transactions, ordered `event_log` replay, idempotent client handlers |
| No Firebase/Supabase/managed realtime DB | ✅ | PostgreSQL is storage only; realtime protocol/event log/broker are implemented by this repo |
| Assume 2MB+ project payloads | ✅ | Project list intentionally excludes metadata; detail fetched separately; tasks independently paginated |
| Avoid resending whole projects | ✅ | Entity-level event payloads only |
| Preferred Next.js / Go stack | ✅ | Next.js App Router frontend + Go `net/http` API |

## Bonus points

| Bonus | Status | Implementation |
|---|---:|---|
| Event-based backend | ✅ | Append-only `event_log`; mutation and event appended in one transaction |
| Clear domain model | ✅ | Project/Task/Comment structs + invariant helpers |
| Optimistic UI + rollback | ✅ | Task/project edits, creates and comments reconcile against authoritative server response |
| Database transactions | ✅ | Serializable task/project mutations + event append |
| Caching strategy | Documented | Not needed for correctness; production path documented in architecture |
| Rate limiting/backpressure | 🟡 | Backpressure is handled with bounded subscriber queues + durable catch-up. Distributed rate limiting is intentionally a production follow-up. |
| Type-safe API contract | Partial by design | Strict TypeScript frontend models + OpenAPI + Go structs. Cross-language generation is described as a next step rather than falsely claimed. |

## Extended Challenge 1 — Performance & Scale

| Item | Status | Implementation |
|---|---:|---|
| Virtual scrolling for 10,000+ tasks | ✅ | Fixed-row windowing in `TaskList.tsx` |
| Lazy loading / cursor pagination | ✅ | `(created_at,id)` keyset cursor; no deep OFFSET |
| Database indexing | ✅ | project/order/status, trigram title search, comments, event replay, dependency GIN |
| Load testing harness | ✅ | `scripts/load.mjs`; can automatically write the measured report to `docs/PERFORMANCE_RESULTS.md` |
| Measured load-test results | ✅ | 10,000/10,000 successful writes, 0 failures, 3,126.3 writes/s; cursor-read p95 5.5 ms. See `docs/PERFORMANCE_RESULTS.md`. |

## Extended Challenge 3 — Developer Experience

- Go domain unit tests.
- API + realtime integration smoke test.
- Playwright cross-client collaboration tests.
- GitHub Actions for Go build/test, Next typecheck/build, API integration, and browser E2E.
- Idempotent SQL migration runner with an advisory lock for concurrent cold starts.
- Demo seeding and load scripts.
- OpenAPI document.
- Docker Compose and VS Code tasks.
- Vercel Services + Neon deployment configuration.
