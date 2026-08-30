#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_E2E=0
if [[ "${1:-}" == "--skip-e2e" ]]; then
  SKIP_E2E=1
fi

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return $?
  fi
  return 1
}

choose_port() {
  local preferred="$1"
  local fallback="$2"
  if ! port_in_use "$preferred"; then
    echo "$preferred"
  elif ! port_in_use "$fallback"; then
    echo "$fallback"
  else
    local p="$fallback"
    while port_in_use "$p"; do p=$((p + 1)); done
    echo "$p"
  fi
}

export WEB_HOST_PORT="${WEB_HOST_PORT:-$(choose_port 3000 3100)}"
export API_HOST_PORT="${API_HOST_PORT:-$(choose_port 8080 8180)}"

cleanup_on_error() {
  code=$?
  if [[ $code -ne 0 ]]; then
    echo
    echo "Verification failed. Recent container logs:"
    docker compose logs --tail=120 || true
  fi
  exit $code
}
trap cleanup_on_error EXIT

echo "==> Verify committed dependency locks"
[[ -s services/api/go.mod ]] || { echo "ERROR: services/api/go.mod is missing"; exit 1; }
[[ -s services/api/go.sum ]] || { echo "ERROR: services/api/go.sum is missing"; exit 1; }
[[ -f apps/web/package.json ]] || { echo "ERROR: apps/web/package.json is missing"; exit 1; }

echo "==> Local endpoints"
echo "    Web: http://localhost:${WEB_HOST_PORT}"
echo "    API: http://localhost:${API_HOST_PORT}"
echo "    PostgreSQL: internal Docker network only (no host port)"

echo "==> Clean Docker build"
docker compose down -v --remove-orphans || true
docker compose build --no-cache

echo "==> Start stack"
docker compose up -d

echo "==> Wait for API"
for _ in {1..90}; do
  if curl -fsS "http://localhost:${API_HOST_PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://localhost:${API_HOST_PORT}/health" >/dev/null

echo "==> Wait for web"
for _ in {1..90}; do
  if curl -fsS "http://localhost:${WEB_HOST_PORT}" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://localhost:${WEB_HOST_PORT}" >/dev/null

echo "==> API + realtime smoke test"
API_URL="http://localhost:${API_HOST_PORT}" node scripts/smoke.mjs

if [[ $SKIP_E2E -eq 0 ]]; then
  echo "==> Browser E2E"
  npm --prefix apps/web install
  npx --yes --prefix apps/web playwright install chromium
  PLAYWRIGHT_BASE_URL="http://localhost:${WEB_HOST_PORT}" API_URL="http://localhost:${API_HOST_PORT}" npm --prefix apps/web run test:e2e
fi

echo
echo "LOCAL VERIFICATION PASS"
echo "Web: http://localhost:${WEB_HOST_PORT}"
echo "API: http://localhost:${API_HOST_PORT}"
trap - EXIT
