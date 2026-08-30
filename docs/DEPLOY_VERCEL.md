# Production deployment on Vercel

The repository is configured for a **single Vercel project** using Vercel Services:

- `apps/web` — Next.js frontend container.
- `services/api` — Go API container.
- Neon — durable PostgreSQL backing service.
- root `vercel.json` — routes `/api/*` and `/health` to Go and everything else to Next.js.

This keeps the architecture shown in the take-home rather than replacing the Go backend for hosting convenience.

## 1. Push the repository to GitHub

Create the required private repository and push this folder. Invite `carlos-happyrobot` and `joaquinllopez00` before submission.

## 2. Create/import the Vercel project

Import the GitHub repository in Vercel. Leave the repository root as the project root; `vercel.json` defines the two services.

Vercel Services is currently a public-beta platform feature. If your account UI asks you to enable Services/Containers, enable it for this project.

## 3. Provision Neon PostgreSQL

From Vercel Marketplace add **Neon**. This is being used only as PostgreSQL storage; the app does not use a provider realtime product.

Create two connection environment variables:

```text
DATABASE_URL=<Neon pooled connection string with sslmode=require>
REALTIME_DATABASE_URL=<Neon direct/unpooled connection string with sslmode=require>
```

The direct connection is used only for PostgreSQL LISTEN/NOTIFY. The pooled URL is used by request traffic.

Also set:

```text
AUTO_MIGRATE=true
DB_MAX_CONNS=5
CORS_ORIGIN=https://happyrobot-realtime-tasks.vercel.app
```

Do **not** set `NEXT_PUBLIC_API_URL` in Vercel. The browser intentionally calls same-origin `/api/*`, which `vercel.json` routes to the Go service.

## 4. Deploy

Deploy from the Vercel dashboard or CLI:

```bash
npm install -g vercel
vercel --prod
```

The Go service runs the idempotent migrations at startup. Migration execution is guarded by a PostgreSQL advisory lock so simultaneous cold starts do not race migration application.

## 5. Verify production

The current production domain is `https://happyrobot-realtime-tasks.vercel.app`. For another deployment, replace it with your domain:

```bash
curl https://<your-domain>/health
API_URL=https://<your-domain> node scripts/smoke.mjs
```

Then open the production URL in two separate browser windows, select the same project, and verify project/task/comment changes propagate without refresh.

## 6. Production benchmark

Do not run 10,000 writes against a free/shared production database unless you understand its quotas. Prefer the local benchmark for the take-home:

```bash
WRITE_RESULTS=1 TASKS=10000 CONCURRENCY=25 node scripts/load.mjs
```

The measured local submission run is already recorded in `docs/PERFORMANCE_RESULTS.md`.

## If Vercel Services is unavailable on the account

Deploy `services/api` as a standalone Vercel Go/container project and `apps/web` as a separate Vercel project, then set the web project's `NEXT_PUBLIC_API_URL` to the API deployment URL and set API `CORS_ORIGIN` to the web URL. The one-project Services configuration is preferred because it gives one public origin and avoids cross-origin browser traffic.
