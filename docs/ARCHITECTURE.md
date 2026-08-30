# Architecture

## System shape

```mermaid
flowchart LR
  A[Next.js App Router client] -->|REST commands + version| B[Go API]
  B -->|serializable transaction| C[(PostgreSQL)]
  B -->|state + append event + pg_notify| C
  C -->|LISTEN/NOTIFY event id| D[Go realtime listener]
  D --> E[bounded in-process wake-up broker]
  E -->|wake stream| B
  B -->|ordered SSE entity deltas| A
  A -->|Last-Event-ID reconnect| B
  A -. repeated stream failure .->|1.5s delta polling| B
  B -->|canonical event_log replay| C
```

PostgreSQL is a durable database, **not** a managed realtime database. Realtime behavior is implemented in this repository with an append-only event log, notification listener, SSE endpoints, replay, and a polling fallback.

## Write path

1. The browser applies an optimistic patch locally.
2. It sends a narrow REST command with the entity's current `version`.
3. The API opens a transaction and locks the current row with `FOR UPDATE`.
4. Domain invariants are validated.
5. The row is updated and its version increments.
6. The same transaction appends a compact event to `event_log` and calls `pg_notify` with only the event id.
7. PostgreSQL emits NOTIFY on commit.
8. Connected API instances wake their SSE streams, which read all ordered events after their current cursor from `event_log`.
9. The browser reconciles optimistic state. A `409` returns the authoritative current entity and rolls the client back/reconciles.

A notification is only a **wake-up hint**. The stream never advances its durable cursor merely because an in-memory notification arrived. It advances only after reading the canonical event rows, so a full broker buffer cannot create a silent event gap.

## Snapshot → stream consistency

Task snapshots and the project catalog return a `syncCursor` captured before reading the snapshot. The client starts the stream from that cursor. A concurrent change is therefore either already represented in the snapshot, replayed after the cursor, or both. Handlers are idempotent, so at-least-once delivery is safe.

## Large projects

The 2MB+ constraint changes the API shape:

- `GET /api/projects` returns only lightweight summary fields and a sync cursor.
- `GET /api/projects/:id` fetches full description/metadata only for the selected project.
- Tasks live in independent rows and are keyset-paginated.
- Task dependency search uses a trigram title index instead of requiring all tasks in browser memory.
- Realtime messages contain one changed entity/patch, never the entire project.

## Why SSE + REST?

Commands are naturally request/response and need clear validation/conflict semantics, so they use REST. Collaboration updates in this scope are predominantly server → client, making SSE simple and debuggable while retaining event IDs and browser reconnection.

Vercel may recycle/terminate long-lived function/container invocations. That is safe here: EventSource reconnects using a cursor, the API replays from `event_log`, and after repeated stream failures the browser falls back to 1.5-second event-log polling. Correctness does not depend on one immortal connection.

Live cursors or collaborative character-by-character text editing would be a different workload and would justify WebSockets plus CRDT/OT.

## Multi-instance behavior

Every Go API instance can maintain its own PostgreSQL LISTEN connection. NOTIFY wakes each instance, while `event_log` remains the durable truth. On Neon production deployments use:

- `DATABASE_URL`: pooled connection string for normal API queries.
- `REALTIME_DATABASE_URL`: direct/unpooled connection string for LISTEN/NOTIFY session semantics.

Pool size defaults to five connections per API instance and is configurable with `DB_MAX_CONNS`.

## Production deployment

One Vercel project contains two services:

```text
/health, /api/*  -> Go container service
/*                -> Next.js container service
                      |
                      +-> same-origin browser calls

Go -> Neon PostgreSQL
```

Local development retains Docker Compose with PostgreSQL 16.

## Scale path

- Partition/archive `event_log` by time/project when retention volume warrants it.
- Replace LISTEN/NOTIFY wake-up fan-out with NATS/Kafka/Redis Streams when event rate or connection topology requires it; preserve the same durable event contract.
- Add per-project auth, tenant-aware quotas, rate limiting and audit identities.
- Add read replicas for historical/activity reads.
- Move large binary attachments to object storage.
- Add metrics for write conflict rate, replay lag, SSE reconnect rate, propagation p95/p99 and DB saturation.

## API security and pagination boundaries

Cursors and query parameters are treated as untrusted input. Task pagination decodes the opaque cursor and feeds its values into parameterized PostgreSQL queries rather than concatenating user input into SQL. Page size defaults to 100 and is bounded to 250. Durable event-delta reads default to 250 and are bounded to 1,000. JSON request bodies are limited to 8 MiB and unknown JSON fields are rejected.

CORS supports an explicit comma-separated allowlist. Database credentials stay behind the Go API; the browser never receives a PostgreSQL connection string.

Authentication and tenant authorization are intentionally outside this exercise's implementation scope. In a production multi-tenant system, every project/task/comment query would also be constrained by the authenticated user's project membership. A cursor would only express a position inside an already-authorized result set and would never grant access by itself.
