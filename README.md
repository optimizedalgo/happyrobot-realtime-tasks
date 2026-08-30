# HappyRobot Realtime Task Control

A real-time collaborative task-management system built with **Next.js App Router, Go, and PostgreSQL**. The design is optimized for correct multi-client collaboration and projects that can grow beyond multi-megabyte payloads without resending the whole project on every change.

**Live demo:** https://happyrobot-realtime-tasks.vercel.app  
**Production health:** https://happyrobot-realtime-tasks.vercel.app/health

## Architecture

![HappyRobot collaborative task system architecture](docs/architecture.svg)

The application runs as a single-origin Vercel Services project. The Next.js frontend communicates with a Go API for REST mutations, cursor-based reads, and SSE realtime updates. PostgreSQL is the source of truth; transactions and version checks protect consistency, while an append-only `event_log` plus `LISTEN/NOTIFY` provide low-latency delivery with durable replay.

Large projects scale through keyset pagination, database indexes, virtualized rendering, and entity-level realtime deltas rather than rebroadcasting complete project payloads.

[Detailed architecture](docs/ARCHITECTURE.md) · [Editable Excalidraw](docs/architecture.excalidraw) · [Performance results](docs/PERFORMANCE_RESULTS.md) · [API contract](docs/openapi.yaml)

## What is implemented

### Core functionality

- Multiple projects with editable name, description, and metadata.
- Create, update, and delete tasks.
- Assignees, priority, description, tags, and custom fields.
- Searchable task dependencies without loading the whole project into browser memory.
- Server-side status-transition rules.
- Same-project dependency validation, recursive cycle detection, and completion guards.
- Per-task comment threads.
- Near-real-time project/task/comment synchronization across clients.
- Optimistic UI with authoritative reconciliation on conflicts.
- No Firebase, Supabase realtime, or managed realtime database.

### Realtime and consistency

- Append-only durable `event_log`.
- State mutation + event append in the same PostgreSQL transaction.
- PostgreSQL `LISTEN/NOTIFY` used only as a low-latency wake-up signal.
- Ordered event-log replay so missed in-memory notifications cannot create durable gaps.
- SSE with `Last-Event-ID` reconnect/replay.
- Automatic 1.5-second durable delta-polling fallback after repeated stream failure.
- Versioned project/task writes with row locking and HTTP `409` reconciliation.
- Snapshot → stream handoff using `syncCursor` and idempotent client handlers.

### Scale

- Lightweight project catalog; large metadata is fetched only for the selected project.
- `(created_at, id)` keyset/cursor task pagination; no deep `OFFSET` pagination.
- Task page size is bounded server-side to a maximum of 250.
- Durable event-delta reads are bounded to a maximum of 1,000 rows.
- Parameterized PostgreSQL queries; cursors are treated as untrusted input and never concatenated into SQL.
- Fixed-row virtualized task rendering.
- Trigram-backed task-title search for dependency lookup.
- Database indexes for ordering, filtering, comments, event replay, dependency lookup, and title search.
- Configurable PostgreSQL pool sizing for horizontal API scale-out.
- Small entity-level realtime messages instead of multi-megabyte project rebroadcasts.

### Developer experience

- Docker Compose local stack.
- Idempotent migration runner guarded by a PostgreSQL advisory lock.
- Seed script.
- 10,000-task benchmark harness with measured results committed in `docs/PERFORMANCE_RESULTS.md`.
- Go unit/domain tests.
- API + realtime integration smoke suite.
- Playwright two-client collaboration and domain-rule tests.
- GitHub Actions CI.
- OpenAPI 3.1 document.
- VS Code workspace/tasks.
- Vercel Services + Neon deployment configuration.

See [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) for requirement-by-requirement coverage.

## Measured performance

Local benchmark command:

```bash
API_URL=http://localhost:8181 \
WRITE_RESULTS=1 \
TASKS=10000 \
CONCURRENCY=25 \
node scripts/load.mjs
```

Measured result:

| Metric | Result |
|---|---:|
| Successful writes | 10,000 / 10,000 |
| Failed writes | 0 |
| Write throughput | 3,126.3 tasks/s |
| Tasks read | 10,000 |
| Cursor pages | 100 |
| Page p50 | 1.0 ms |
| Page p95 | 5.5 ms |
| Page p99 | 10.4 ms |

Full report: [`docs/PERFORMANCE_RESULTS.md`](docs/PERFORMANCE_RESULTS.md).

These are local benchmark results, not a production-throughput claim. The 10,000-write test is intentionally not run against the free/shared production database.

## Local run with Docker Desktop

From the repository root:

```bash
docker compose down -v --remove-orphans
docker compose up --build
```

Open:

- Web: `http://localhost:3000`
- API health: `http://localhost:8080/health`

The API applies migrations automatically.

### Full local verification

```bash
./scripts/verify-local.sh
```

This performs a clean Docker build, starts a fresh database, runs the API/realtime smoke suite, and runs the two-client Playwright tests.

For a faster API/realtime-only check after the stack is already running:

```bash
node scripts/smoke.mjs
```

Expected result:

```text
SMOKE PASS
```

## Demo data

```bash
node scripts/seed.mjs
```

Open the generated **Launch Operations** project in two windows to demonstrate collaboration.

## Manual development

Open `happyrobot.code-workspace`, or start each service manually.

PostgreSQL:

```bash
docker compose up db
```

API:

```bash
cd services/api
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/happyrobot?sslmode=disable'
export REALTIME_DATABASE_URL="$DATABASE_URL"
export PORT=8080
export CORS_ORIGIN='http://localhost:3000,http://127.0.0.1:3000'
export AUTO_MIGRATE=true
go mod download
go run ./cmd/server
```

Frontend, in another terminal:

```bash
cd apps/web
npm install
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev
```

## Production deployment

The repository deploys the frontend and API as **one Vercel project** via root `vercel.json`:

```text
/api/* + /health -> Go container service
everything else  -> Next.js container service
```

Neon provides durable PostgreSQL storage. It is not used as a managed realtime product; the realtime event protocol, replay, and fallback are implemented in this repository.

Production variables:

```text
DATABASE_URL=<Neon pooled PostgreSQL URL>
REALTIME_DATABASE_URL=<Neon direct/unpooled PostgreSQL URL>
AUTO_MIGRATE=true
DB_MAX_CONNS=5
CORS_ORIGIN=https://happyrobot-realtime-tasks.vercel.app
```

Do not set `NEXT_PUBLIC_API_URL` for the one-project deployment. Browser traffic stays same-origin and Vercel routes `/api/*` to the Go service.

Deployment instructions: [`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md).

Production verification:

```bash
curl https://happyrobot-realtime-tasks.vercel.app/health
API_URL=https://happyrobot-realtime-tasks.vercel.app node scripts/smoke.mjs
```

The production smoke suite has been run successfully with `SMOKE PASS`.

## Consistency model

### Versioned writes

Tasks and projects carry an integer `version`. A mutation sends the version held by the client. The API locks the current row inside a transaction and rejects stale writes with HTTP `409` plus the authoritative entity. UI state is optimistic but reconciles to the server response.

### Snapshot → stream handoff

Project/task snapshots include a `syncCursor` captured before the snapshot query. The browser starts event replay from that cursor. A concurrent event can be represented in both snapshot and replay, but it cannot silently fall into a gap; event handlers are idempotent.

### Domain invariants

The server owns the rules:

- valid task statuses and explicit transitions;
- dependencies must exist in the same project;
- self-dependency and recursive cycles are rejected;
- tasks cannot complete until dependencies are done;
- completed dependencies cannot be reopened while completed dependents rely on them;
- referenced dependency tasks cannot be deleted.

## Security boundary

The submitted system protects data integrity and backend resource usage, but it deliberately does **not** pretend to include a production identity layer.

Implemented protections include:

- database credentials remain server-side;
- strict JSON decoding with unknown-field rejection;
- request bodies are capped at 8 MiB;
- pagination/event page sizes are bounded server-side;
- cursor values are decoded and used only through parameterized SQL values;
- server-side domain validation prevents clients from bypassing dependency/status rules;
- version checks and database row locking protect conflicting writes;
- configurable CORS allowlist;
- HTTP read-header timeout and graceful shutdown.

Authentication/authorization, tenant isolation, audit identity, abuse detection, and a distributed per-user/IP rate limiter are production extensions. A future auth layer would authorize every project-scoped request independently; a pagination cursor would remain only a position token, never an authorization token.

## Why SSE?

REST handles client → server commands with clear validation and conflict semantics. Collaboration updates in this scope are predominantly server → client, so SSE is simple, HTTP-native, and naturally carries event IDs for durable replay.

If the product later adds live cursors or collaborative character-level text editing, that is a different workload and would justify WebSockets plus CRDT/OT rather than forcing those semantics into task events.

## Key files

```text
apps/web/app/page.tsx                    main collaborative UI
apps/web/components/TaskList.tsx        virtualized task list
apps/web/components/TaskDetail.tsx      task fields/comments
apps/web/components/DependencyPicker.tsx scalable dependency search
apps/web/components/ProjectSettings.tsx project metadata editor
apps/web/lib/realtime.ts                 SSE + durable polling fallback
services/api/internal/api/server.go     API, invariants, pagination, replay
services/api/internal/db/db.go          pool + migration runner
services/api/internal/realtime/         PostgreSQL notification wake-up
services/api/migrations/001_init.sql    schema + indexes
apps/web/e2e/                            cross-client browser tests
scripts/smoke.mjs                        API/realtime integration suite
scripts/load.mjs                         10k benchmark + report writer
docs/architecture.svg                   README architecture diagram
docs/architecture.excalidraw            editable architecture source
vercel.json                              two-service Vercel routing
```

## Deliberate scope boundaries

Authentication/authorization, CRDT text editing, live cursors, @mentions, Redis/NATS/Kafka, and a global distributed rate limiter are not required by the exercise and are not faked. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) describes the scale path and where those capabilities would fit as the product grows.
