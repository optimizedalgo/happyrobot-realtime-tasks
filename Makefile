.PHONY: dev-api dev-web test smoke e2e verify load docker-up docker-down docker-clean

dev-api:
	cd services/api && go run ./cmd/server

dev-web:
	cd apps/web && npm install && NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev

test:
	cd services/api && go test ./...

smoke:
	node scripts/smoke.mjs

e2e:
	cd apps/web && npm run test:e2e

verify:
	./scripts/verify-local.sh
docker-up:
	docker compose up --build

docker-down:
	docker compose down

docker-clean:
	docker compose down -v --remove-orphans
	docker compose build --no-cache

load:
	WRITE_RESULTS=1 TASKS=10000 CONCURRENCY=25 node scripts/load.mjs
